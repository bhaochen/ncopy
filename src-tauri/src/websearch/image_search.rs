//! Image search via text-to-image engines.
//!
//! [`search_images`] races SearXNG (`categories=images`) and Tavily
//! (`include_images=true`) in parallel and fuses their image result lists.
//!
//! Reverse image search (upload an image to find similar images / source
//! pages) is not yet implemented — the major engines (Google, Bing, Yandex)
//! all render results client-side and cannot be scraped from HTML alone.

use crate::net::transport::{HttpMethod, HttpRequest, HttpTransport};
use crate::trace::EngineStat;

/// One image search result row.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ImageSearchHit {
    pub title: String,
    pub url: String,
    pub img_src: String,
    #[serde(default)]
    pub thumbnail_src: String,
    pub source: String,
}

/// Result from the image search pipeline.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ImageSearchResult {
    pub hits: Vec<ImageSearchHit>,
    pub stats: Vec<crate::trace::EngineStat>,
}

/// Searches for images matching `query` by racing SearXNG (`categories=images`)
/// and Tavily (`include_images=true`).
pub async fn search_images(
    transport: &dyn HttpTransport,
    query: &str,
    health: &super::engine::EngineHealth,
) -> ImageSearchResult {
    use futures_util::future::join_all;

    let mut tasks = Vec::new();
    let mut lists: Vec<Vec<ImageSearchHit>> = Vec::new();
    let mut stats: Vec<EngineStat> = Vec::new();

    for engine in IMAGE_ENGINES {
        if health.is_cooling(engine.name) {
            stats.push(EngineStat {
                name: engine.name.to_string(),
                status: "cooling".to_string(),
                hit_count: 0,
            });
            continue;
        }
        let request = (engine.build)(query);
        let engine_name = engine.name;
        let engine_parse = engine.parse;
        tasks.push(async move {
            match transport.send(&request).await {
                Err(_) => (engine_name, "error".to_string(), Vec::new()),
                Ok(response) => {
                    let body = String::from_utf8_lossy(&response.body);
                    let hits = engine_parse(&body);
                    let status = if hits.is_empty() { "empty" } else { "ok" };
                    (engine_name, status.to_string(), hits)
                }
            }
        });
    }

    for (name, status, hits) in join_all(tasks).await {
        let count = hits.len();
        stats.push(EngineStat {
            name: name.to_string(),
            status,
            hit_count: count,
        });
        lists.push(hits);
    }

    let fused = fuse_image_hits(lists);
    ImageSearchResult { hits: fused, stats }
}

// ─── Engine definition ────────────────────────────────────────────────────────

struct ImageEngine {
    name: &'static str,
    build: fn(&str) -> HttpRequest,
    parse: fn(&str) -> Vec<ImageSearchHit>,
}

const IMAGE_ENGINES: &[ImageEngine] = &[
    ImageEngine {
        name: "searxng_images",
        build: searxng_images_request,
        parse: parse_searxng_images_json,
    },
    ImageEngine {
        name: "tavily_images",
        build: tavily_images_request,
        parse: parse_tavily_images_json,
    },
];

fn searxng_images_request(query: &str) -> HttpRequest {
    let base_url =
        std::env::var("SEARXNG_BASE_URL").unwrap_or_else(|_| "http://localhost:8080".to_string());
    let mut url = url::Url::parse(&base_url).expect("SEARXNG_BASE_URL");
    url = url.join("/search").expect("append /search");
    url.query_pairs_mut()
        .append_pair("q", query)
        .append_pair("format", "json")
        .append_pair("categories", "images");
    HttpRequest {
        method: HttpMethod::Get,
        url: url.to_string(),
        headers: vec![
            (
                "User-Agent".to_string(),
                super::engine::BROWSER_USER_AGENT.to_string(),
            ),
            ("Accept".to_string(), "application/json".to_string()),
        ],
        form: Vec::new(),
        body: None,
        bypass_ssrf: true,
    }
}

fn parse_searxng_images_json(body: &str) -> Vec<ImageSearchHit> {
    let json: serde_json::Value = match serde_json::from_str(body) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    json.get("results")
        .and_then(|r| r.as_array())
        .map(|results| {
            results
                .iter()
                .filter_map(|r| {
                    let title = r
                        .get("title")
                        .and_then(|t| t.as_str())
                        .unwrap_or_default()
                        .to_string();
                    let url = r
                        .get("url")
                        .and_then(|u| u.as_str())
                        .unwrap_or_default()
                        .to_string();
                    let img_src = r
                        .get("img_src")
                        .and_then(|i| i.as_str())
                        .or_else(|| r.get("thumbnail_src").and_then(|t| t.as_str()))
                        .unwrap_or_default()
                        .to_string();
                    let thumbnail_src = r
                        .get("thumbnail_src")
                        .and_then(|t| t.as_str())
                        .unwrap_or_default()
                        .to_string();
                    if url.is_empty() || img_src.is_empty() {
                        return None;
                    }
                    Some(ImageSearchHit {
                        title,
                        url,
                        img_src,
                        thumbnail_src,
                        source: "searxng".to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn tavily_images_request(query: &str) -> HttpRequest {
    let api_key = tavily_api_key();
    let body = serde_json::json!({
        "query": query,
        "max_results": 10,
        "search_depth": "basic",
        "topic": "general",
        "include_images": true,
    })
    .to_string();
    HttpRequest {
        method: HttpMethod::Post,
        url: "https://api.tavily.com/search".to_string(),
        headers: vec![
            ("Authorization".to_string(), format!("Bearer {api_key}")),
            ("Content-Type".to_string(), "application/json".to_string()),
            (
                "User-Agent".to_string(),
                super::engine::BROWSER_USER_AGENT.to_string(),
            ),
        ],
        form: Vec::new(),
        body: Some(body),
        bypass_ssrf: false,
    }
}

fn parse_tavily_images_json(body: &str) -> Vec<ImageSearchHit> {
    let json: serde_json::Value = match serde_json::from_str(body) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    let mut hits = Vec::new();

    if let Some(images) = json.get("images").and_then(|i| i.as_array()) {
        for img_url in images {
            if let Some(url) = img_url.as_str() {
                if !url.is_empty() {
                    hits.push(ImageSearchHit {
                        title: String::new(),
                        url: url.to_string(),
                        img_src: url.to_string(),
                        thumbnail_src: String::new(),
                        source: "tavily".to_string(),
                    });
                }
            }
        }
    }

    if let Some(results) = json.get("results").and_then(|r| r.as_array()) {
        for result in results {
            let title = result
                .get("title")
                .and_then(|t| t.as_str())
                .unwrap_or_default()
                .to_string();
            let page_url = result
                .get("url")
                .and_then(|u| u.as_str())
                .unwrap_or_default()
                .to_string();
            if let Some(images) = result.get("images").and_then(|i| i.as_array()) {
                for img_url in images {
                    if let Some(url) = img_url.as_str() {
                        if !url.is_empty() {
                            hits.push(ImageSearchHit {
                                title: title.clone(),
                                url: page_url.clone(),
                                img_src: url.to_string(),
                                thumbnail_src: String::new(),
                                source: "tavily".to_string(),
                            });
                        }
                    }
                }
            }
        }
    }

    hits
}

fn tavily_api_key() -> String {
    static CACHE: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    CACHE
        .get_or_init(|| {
            if let Ok(key) = std::env::var("TAVILY_API_KEY") {
                if !key.is_empty() {
                    return key;
                }
            }
            let home = std::env::var("HOME").unwrap_or_default();
            let path = std::path::Path::new(&home).join(".claude/settings.json");
            let content = std::fs::read_to_string(path).ok();
            match content.and_then(|c| serde_json::from_str::<serde_json::Value>(&c).ok()) {
                Some(json) => json
                    .get("env")
                    .and_then(|e| e.get("TAVILY_API_KEY"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                None => String::new(),
            }
        })
        .clone()
}

fn fuse_image_hits(lists: Vec<Vec<ImageSearchHit>>) -> Vec<ImageSearchHit> {
    let mut seen = std::collections::HashSet::new();
    let mut fused = Vec::new();
    for list in lists {
        for hit in list {
            if seen.insert(hit.img_src.clone()) {
                fused.push(hit);
            }
        }
    }
    fused
}
