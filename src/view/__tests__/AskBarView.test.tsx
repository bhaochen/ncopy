import React from 'react';
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  KEY_DOWN_COMMAND,
  type LexicalEditor,
} from 'lexical';
import { AskBarView } from '../AskBarView';
import type { AttachedImage } from '../../types/image';
import { MAX_IMAGE_SIZE_BYTES } from '../../types/image';
import {
  ConfigProviderForTest,
  DEFAULT_CONFIG,
} from '../../contexts/ConfigContext';
import { invoke } from '../../testUtils/mocks/tauri';

const { readImageMock, readTextMock } = vi.hoisted(() => ({
  readImageMock: vi.fn(),
  readTextMock: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  readImage: readImageMock,
  readText: readTextMock,
}));

function makeRef(): React.RefObject<HTMLDivElement | null> {
  return { current: null };
}

/** The AskBar's Lexical contentEditable (role="textbox"). */
function getInput(): HTMLElement {
  return screen.getByRole('textbox');
}

/** The Lexical editor backing the input, read off the root DOM node. */
function getEditor(): LexicalEditor {
  return (getInput() as unknown as { __lexicalEditor: LexicalEditor })
    .__lexicalEditor;
}

/**
 * Replaces the editor's text, mimicking the user typing `text`. jsdom does not
 * synthesize contentEditable input from key events, so edits are applied through
 * the editor API; this still exercises the real value-sync path (onValueChange).
 */
function typeText(text: string): void {
  const editor = getEditor();
  act(() => {
    editor.update(() => {
      const root = $getRoot();
      root.clear();
      const paragraph = $createParagraphNode();
      if (text) paragraph.append($createTextNode(text));
      root.append(paragraph);
    });
  });
}

/** Helper to create an AttachedImage with defaults. */
function makeImage(overrides: Partial<AttachedImage> = {}): AttachedImage {
  return {
    id: overrides.id ?? 'test-id',
    blobUrl: overrides.blobUrl ?? 'blob:http://localhost/test',
    filePath: overrides.filePath ?? '/tmp/img.jpg',
    ...overrides,
  };
}

/** Default image-related props shared across all AskBarView test renders. */
const IMAGE_DEFAULTS = {
  attachedImages: [] as AttachedImage[],
  onImagesAttached: vi.fn(),
  onImageRemove: vi.fn(),
  onImagePreview: vi.fn(),
  onScreenshot: vi.fn(),
  maxImages: 3,
};

describe('AskBarView', () => {
  it('renders the input with placeholder for input bar mode', () => {
    render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query=""
        setQuery={vi.fn()}
        isChatMode={false}
        isGenerating={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        inputRef={makeRef()}
      />,
    );
    expect(screen.getByText('Ask Thuki anything...')).toBeInTheDocument();
  });

  it('renders the input with chat mode placeholder', () => {
    render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query=""
        setQuery={vi.fn()}
        isChatMode={true}
        isGenerating={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        inputRef={makeRef()}
      />,
    );
    expect(screen.getByText('Reply...')).toBeInTheDocument();
  });

  it('renders the ambient download strip when a download status is supplied', () => {
    render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query=""
        setQuery={vi.fn()}
        isChatMode={false}
        isGenerating={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        inputRef={makeRef()}
        downloadStatus={{
          kind: 'downloading',
          modelName: 'Qwen3.5 9B',
          percent: 40,
          etaSeconds: 90,
          onPause: vi.fn(),
        }}
      />,
    );
    expect(screen.getByTestId('download-status-strip')).toBeInTheDocument();
    expect(screen.getByText('Downloading Qwen3.5 9B')).toBeInTheDocument();
  });

  it('renders no download strip when no download status is supplied', () => {
    render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query=""
        setQuery={vi.fn()}
        isChatMode={false}
        isGenerating={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        inputRef={makeRef()}
        downloadStatus={null}
      />,
    );
    expect(
      screen.queryByTestId('download-status-strip'),
    ).not.toBeInTheDocument();
  });

  it('disables the send button while a model is downloading, even with text typed', () => {
    render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query="Hello?"
        setQuery={vi.fn()}
        isChatMode={false}
        isGenerating={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        inputRef={makeRef()}
        downloadStatus={{
          kind: 'downloading',
          modelName: 'Qwen3.5 9B',
          percent: 58,
          etaSeconds: 180,
          onPause: vi.fn(),
        }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  });

  it('reports listening while the input holds focus and idle when it loses it', () => {
    const onListeningChange = vi.fn();
    render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query=""
        setQuery={vi.fn()}
        isChatMode={false}
        isGenerating={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        inputRef={makeRef()}
        onListeningChange={onListeningChange}
      />,
    );
    const input = getInput();
    // Autofocus from Lexical's AutoFocusPlugin is scheduled asynchronously, so
    // the test drives focus transitions explicitly instead of relying on it.
    fireEvent.focusIn(input);
    expect(onListeningChange).toHaveBeenLastCalledWith(true);

    fireEvent.focusOut(input);
    expect(onListeningChange).toHaveBeenLastCalledWith(false);

    fireEvent.focusIn(input);
    expect(onListeningChange).toHaveBeenLastCalledWith(true);
  });

  it('focus changes are safe when onListeningChange is omitted', () => {
    render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query=""
        setQuery={vi.fn()}
        isChatMode={false}
        isGenerating={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        inputRef={makeRef()}
      />,
    );
    const input = getInput();
    // Firing focus transitions without the callback wired up must not throw.
    expect(() => {
      fireEvent.focusOut(input);
      fireEvent.focusIn(input);
    }).not.toThrow();
  });

  it('keeps the send button disabled while a download is pausing', () => {
    render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query="Hello?"
        setQuery={vi.fn()}
        isChatMode={false}
        isGenerating={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        inputRef={makeRef()}
        downloadStatus={{ kind: 'pausing', percent: 40 }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  });

  it('keeps the send button disabled while a download is paused', () => {
    render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query="Hello?"
        setQuery={vi.fn()}
        isChatMode={false}
        isGenerating={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        inputRef={makeRef()}
        downloadStatus={{
          kind: 'paused',
          percent: 58,
          onResume: vi.fn(),
          onDiscard: vi.fn(),
        }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  });

  it('keeps the send button disabled while a download is verifying', () => {
    render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query="Hello?"
        setQuery={vi.fn()}
        isChatMode={false}
        isGenerating={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        inputRef={makeRef()}
        downloadStatus={{ kind: 'verifying', percent: 40 }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  });

  it('keeps the send button live during a download once a usable model exists', () => {
    // The decoupled gate: a background download no longer holds the bar hostage
    // once any model is usable (the first finished, or another was installed in
    // Settings), so the user can send to the usable model while the download
    // keeps running in the ambient strip.
    render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query="Hello?"
        setQuery={vi.fn()}
        isChatMode={false}
        isGenerating={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        inputRef={makeRef()}
        hasUsableModel
        downloadStatus={{
          kind: 'downloading',
          modelName: 'Qwen3.5 9B',
          percent: 58,
          etaSeconds: 180,
          onPause: vi.fn(),
        }}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Send message' }),
    ).not.toBeDisabled();
  });

  it('keeps the send button enabled once the download is ready', () => {
    render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query="Hello?"
        setQuery={vi.fn()}
        isChatMode={false}
        isGenerating={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        inputRef={makeRef()}
        downloadStatus={{ kind: 'ready', modelName: 'Qwen3.5 9B' }}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Send message' }),
    ).not.toBeDisabled();
  });

  it('calls setQuery when the editor text changes', async () => {
    const setQuery = vi.fn();
    render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query=""
        setQuery={setQuery}
        isChatMode={false}
        isGenerating={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        inputRef={makeRef()}
      />,
    );
    typeText('hello');
    await waitFor(() => expect(setQuery).toHaveBeenCalledWith('hello'));
  });

  it('keeps the input editable during generation so the next message can be drafted', async () => {
    const setQuery = vi.fn();
    render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query=""
        setQuery={setQuery}
        isChatMode={true}
        isGenerating={true}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        inputRef={makeRef()}
      />,
    );
    expect(getInput().getAttribute('contenteditable')).toBe('true');
    typeText('next message');
    await waitFor(() => expect(setQuery).toHaveBeenCalledWith('next message'));
  });

  it('calls onSubmit on Enter key', () => {
    const onSubmit = vi.fn();
    render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query="hello"
        setQuery={vi.fn()}
        isChatMode={false}
        isGenerating={false}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        inputRef={makeRef()}
      />,
    );
    fireEvent.keyDown(getInput(), { key: 'Enter', shiftKey: false });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('does not submit on Shift+Enter', () => {
    const onSubmit = vi.fn();
    render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query="hello"
        setQuery={vi.fn()}
        isChatMode={false}
        isGenerating={false}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        inputRef={makeRef()}
      />,
    );
    fireEvent.keyDown(getInput(), { key: 'Enter', shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('calls onSubmit on button click', () => {
    const onSubmit = vi.fn();
    render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query="hello"
        setQuery={vi.fn()}
        isChatMode={false}
        isGenerating={false}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        inputRef={makeRef()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('shows logo at 40px in input bar mode (w-10 h-10 rounded-xl classes)', () => {
    const { container } = render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query=""
        setQuery={vi.fn()}
        isChatMode={false}
        isGenerating={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        inputRef={makeRef()}
      />,
    );
    const logo = container.querySelector('img[alt="Thuki"]');
    expect(logo).not.toBeNull();
    expect(logo?.classList.contains('w-10')).toBe(true);
    expect(logo?.classList.contains('h-10')).toBe(true);
    expect(logo?.classList.contains('rounded-xl')).toBe(true);
  });

  it('shows logo at 24px in chat mode (w-6 h-6 rounded-lg classes)', () => {
    const { container } = render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query=""
        setQuery={vi.fn()}
        isChatMode={true}
        isGenerating={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        inputRef={makeRef()}
      />,
    );
    const logo = container.querySelector('img[alt="Thuki"]');
    expect(logo).not.toBeNull();
    expect(logo?.classList.contains('w-6')).toBe(true);
    expect(logo?.classList.contains('h-6')).toBe(true);
    expect(logo?.classList.contains('rounded-lg')).toBe(true);
  });

  it('shows send button with accessible label', () => {
    render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query=""
        setQuery={vi.fn()}
        isChatMode={false}
        isGenerating={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        inputRef={makeRef()}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Send message' }),
    ).toBeInTheDocument();
  });

  it('renders a model picker trigger in ask-bar mode when models are available', () => {
    render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query=""
        setQuery={vi.fn()}
        isChatMode={false}
        isGenerating={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        inputRef={makeRef()}
        onModelPickerToggle={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Choose model' }),
    ).toBeInTheDocument();
  });

  it('hides model picker trigger in chat mode (trigger moves to WindowControls header)', () => {
    render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query=""
        setQuery={vi.fn()}
        isChatMode={true}
        isGenerating={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        inputRef={makeRef()}
        onModelPickerToggle={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Choose model' })).toBeNull();
  });

  it('calls onModelPickerToggle when the Choose model button is clicked', () => {
    const onModelPickerToggle = vi.fn();
    render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query=""
        setQuery={vi.fn()}
        isChatMode={false}
        isGenerating={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        inputRef={makeRef()}
        onModelPickerToggle={onModelPickerToggle}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Choose model' }));
    expect(onModelPickerToggle).toHaveBeenCalledTimes(1);
  });

  it('sets aria-expanded on model picker trigger from isModelPickerOpen prop', () => {
    render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query=""
        setQuery={vi.fn()}
        isChatMode={false}
        isGenerating={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        inputRef={makeRef()}
        onModelPickerToggle={vi.fn()}
        isModelPickerOpen={true}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Choose model' }),
    ).toHaveAttribute('aria-expanded', 'true');
  });

  it('renders the model picker inside a Choose model tooltip wrapper in ask-bar mode', () => {
    render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query=""
        setQuery={vi.fn()}
        isChatMode={false}
        isGenerating={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        inputRef={makeRef()}
        onModelPickerToggle={vi.fn()}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Choose model' });
    fireEvent.mouseEnter(trigger.parentElement!);
    expect(screen.getAllByText('Choose model').length).toBeGreaterThanOrEqual(
      1,
    );
  });

  it('still shows the model picker trigger in ask-bar mode with no models so users can recover via the picker', () => {
    // The compose-mode chip stays visible whenever the picker callback is
    // wired up (Ollama reachable). With zero models or no active selection
    // the user must still be able to open the picker to install or pick a
    // model; hiding the chip would strand them.
    render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query=""
        setQuery={vi.fn()}
        isChatMode={false}
        isGenerating={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        inputRef={makeRef()}
        onModelPickerToggle={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Choose model' }),
    ).toBeInTheDocument();
  });

  it('hides the model picker trigger in ask-bar mode when onModelPickerToggle is not provided (Ollama unreachable)', () => {
    render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query=""
        setQuery={vi.fn()}
        isChatMode={false}
        isGenerating={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        inputRef={makeRef()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Choose model' })).toBeNull();
  });

  it('displays selectedText when provided', () => {
    render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query=""
        setQuery={vi.fn()}
        isChatMode={false}
        isGenerating={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        inputRef={makeRef()}
        selectedText="some highlighted text"
      />,
    );
    expect(screen.getByText(/some highlighted text/)).toBeInTheDocument();
  });

  it('hides context area when no selectedText', () => {
    const { container } = render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query=""
        setQuery={vi.fn()}
        isChatMode={false}
        isGenerating={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        inputRef={makeRef()}
      />,
    );
    // The context area uses italic + whitespace-pre-wrap; mirror div also uses
    // whitespace-pre-wrap but is aria-hidden, so check for the italic class.
    expect(container.querySelector('.italic.whitespace-pre-wrap')).toBeNull();
  });

  it('shows stop button with accessible label during generation', () => {
    render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query=""
        setQuery={vi.fn()}
        isChatMode={true}
        isGenerating={true}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        inputRef={makeRef()}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Stop generating' }),
    ).toBeInTheDocument();
  });

  it('calls onCancel when stop button is clicked', () => {
    const onCancel = vi.fn();
    render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query=""
        setQuery={vi.fn()}
        isChatMode={true}
        isGenerating={true}
        onSubmit={vi.fn()}
        onCancel={onCancel}
        inputRef={makeRef()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Stop generating' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('applies spinning ring class to stop button', () => {
    render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query=""
        setQuery={vi.fn()}
        isChatMode={true}
        isGenerating={true}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        inputRef={makeRef()}
      />,
    );
    const btn = screen.getByRole('button', { name: 'Stop generating' });
    expect(btn.classList.contains('stop-btn-ring')).toBe(true);
  });

  it('does not call onSubmit when stop button is clicked during generation', () => {
    const onSubmit = vi.fn();
    render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query="hello"
        setQuery={vi.fn()}
        isChatMode={true}
        isGenerating={true}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        inputRef={makeRef()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Stop generating' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('displays selectedText with whitespace-pre-wrap class', () => {
    const { container } = render(
      <AskBarView
        {...IMAGE_DEFAULTS}
        query=""
        setQuery={vi.fn()}
        isChatMode={false}
        isGenerating={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        inputRef={makeRef()}
        selectedText="context text here"
      />,
    );
    const el = container.querySelector('.whitespace-pre-wrap');
    expect(el).not.toBeNull();
    expect(el?.textContent).toContain('context text here');
  });

  describe('history icon button', () => {
    it('renders history icon button in ask-bar mode when onHistoryOpen is provided', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
          onHistoryOpen={vi.fn()}
        />,
      );
      expect(
        screen.getByRole('button', { name: /history/i }),
      ).toBeInTheDocument();
    });

    it('does not render history icon button in chat mode', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query=""
          setQuery={vi.fn()}
          isChatMode={true}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
          onHistoryOpen={vi.fn()}
        />,
      );
      expect(screen.queryByRole('button', { name: /history/i })).toBeNull();
    });

    it('calls onHistoryOpen when history button is clicked', () => {
      const onHistoryOpen = vi.fn();
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
          onHistoryOpen={onHistoryOpen}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /history/i }));
      expect(onHistoryOpen).toHaveBeenCalledOnce();
    });
  });

  describe('image attachments', () => {
    it('renders image thumbnails when attachedImages is non-empty', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          attachedImages={[
            makeImage({ id: 'img-1', blobUrl: 'blob:http://localhost/1' }),
            makeImage({ id: 'img-2', blobUrl: 'blob:http://localhost/2' }),
          ]}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      expect(
        screen.getByRole('list', { name: /attached images/i }),
      ).toBeInTheDocument();
      expect(screen.getAllByRole('listitem')).toHaveLength(2);
    });

    it('does not render thumbnails when attachedImages is empty', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          attachedImages={[]}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      expect(
        screen.queryByRole('list', { name: /attached images/i }),
      ).toBeNull();
    });

    it('enables submit button when images are attached even without text', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          attachedImages={[makeImage({ id: 'img-1' })]}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const btn = screen.getByRole('button', { name: 'Send message' });
      expect(btn).not.toBeDisabled();
    });

    it('calls onImagePreview when thumbnail is clicked', () => {
      const onImagePreview = vi.fn();
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          attachedImages={[makeImage({ id: 'img-1' })]}
          onImagePreview={onImagePreview}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /preview/i }));
      expect(onImagePreview).toHaveBeenCalledWith('img-1');
    });

    it('calls onImageRemove when remove button is clicked', () => {
      const onImageRemove = vi.fn();
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          attachedImages={[makeImage({ id: 'img-1' })]}
          onImageRemove={onImageRemove}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /remove/i }));
      expect(onImageRemove).toHaveBeenCalledWith('img-1');
    });

    it('applies violet ring when isDragOver is "normal"', () => {
      const { container } = render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
          isDragOver="normal"
        />,
      );
      const wrapper = container.firstElementChild!;
      expect(wrapper.classList.contains('ring-2')).toBe(true);
      expect(wrapper.classList.contains('ring-red-500/60')).toBe(false);
    });

    it('does not apply ring when isDragOver is undefined', () => {
      const { container } = render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const wrapper = container.firstElementChild!;
      expect(wrapper.classList.contains('ring-2')).toBe(false);
    });

    it('applies red ring when isDragOver is "max"', () => {
      const { container } = render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
          isDragOver="max"
        />,
      );
      const wrapper = container.firstElementChild!;
      expect(wrapper.classList.contains('ring-2')).toBe(true);
      expect(wrapper.classList.contains('ring-red-500/60')).toBe(true);
    });

    it('shows "Max 3 images" label when isDragOver is "max"', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
          isDragOver="max"
        />,
      );
      expect(screen.getByText('Max 3 images')).toBeInTheDocument();
    });

    it('does not show max label when isDragOver is "normal"', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
          isDragOver="normal"
        />,
      );
      expect(screen.queryByText('Max 3 images')).toBeNull();
    });

    describe('paste at max images', () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });
      afterEach(() => {
        vi.useRealTimers();
      });

      it('shows error message when paste attempted at max images', () => {
        const onImagesAttached = vi.fn();
        render(
          <AskBarView
            {...IMAGE_DEFAULTS}
            attachedImages={[
              makeImage({ id: 'a' }),
              makeImage({ id: 'b' }),
              makeImage({ id: 'c' }),
              makeImage({ id: 'd' }),
            ]}
            onImagesAttached={onImagesAttached}
            query=""
            setQuery={vi.fn()}
            isChatMode={false}
            isGenerating={false}
            onSubmit={vi.fn()}
            onCancel={vi.fn()}
            inputRef={makeRef()}
          />,
        );
        const textarea = getInput();
        const file = new File(['x'], 'img.png', { type: 'image/png' });
        fireEvent.paste(textarea, {
          clipboardData: {
            getData: () => '',
            items: [{ type: 'image/png', getAsFile: () => file }],
          },
        });
        expect(onImagesAttached).not.toHaveBeenCalled();
        expect(screen.getByText('Max 3 images')).toBeInTheDocument();
      });

      it('paste error message auto-dismisses after 2 seconds', () => {
        render(
          <AskBarView
            {...IMAGE_DEFAULTS}
            attachedImages={[
              makeImage({ id: 'a' }),
              makeImage({ id: 'b' }),
              makeImage({ id: 'c' }),
              makeImage({ id: 'd' }),
            ]}
            onImagesAttached={vi.fn()}
            query=""
            setQuery={vi.fn()}
            isChatMode={false}
            isGenerating={false}
            onSubmit={vi.fn()}
            onCancel={vi.fn()}
            inputRef={makeRef()}
          />,
        );
        const textarea = getInput();
        const file = new File(['x'], 'img.png', { type: 'image/png' });
        fireEvent.paste(textarea, {
          clipboardData: {
            getData: () => '',
            items: [{ type: 'image/png', getAsFile: () => file }],
          },
        });
        expect(screen.getByText('Max 3 images')).toBeInTheDocument();

        act(() => {
          vi.advanceTimersByTime(2000);
        });
        expect(screen.queryByText('Max 3 images')).toBeNull();
      });

      it('does not show paste error when pasting non-image content at max images', () => {
        render(
          <AskBarView
            {...IMAGE_DEFAULTS}
            attachedImages={[
              makeImage({ id: 'a' }),
              makeImage({ id: 'b' }),
              makeImage({ id: 'c' }),
              makeImage({ id: 'd' }),
            ]}
            onImagesAttached={vi.fn()}
            query=""
            setQuery={vi.fn()}
            isChatMode={false}
            isGenerating={false}
            onSubmit={vi.fn()}
            onCancel={vi.fn()}
            inputRef={makeRef()}
          />,
        );
        const textarea = getInput();
        fireEvent.paste(textarea, {
          clipboardData: {
            getData: () => '',
            items: [{ type: 'text/plain', getAsFile: () => null }],
          },
        });
        expect(screen.queryByText('Max 3 images')).toBeNull();
      });
    });

    it('calls onImagesAttached on paste with image', async () => {
      const onImagesAttached = vi.fn();
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          onImagesAttached={onImagesAttached}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const textarea = getInput();
      const file = new File(['fake-img'], 'test.png', { type: 'image/png' });
      const clipboardData = {
        getData: () => '',
        items: [{ type: 'image/png', getAsFile: () => file }],
      };
      fireEvent.paste(textarea, { clipboardData });
      // FileReader is async - wait for the next microtask.
      await vi.waitFor(() => {
        expect(onImagesAttached).toHaveBeenCalledTimes(1);
      });
    });

    it('does not call onImagesAttached on paste with text only', () => {
      const onImagesAttached = vi.fn();
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          onImagesAttached={onImagesAttached}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const textarea = getInput();
      const clipboardData = {
        getData: () => '',
        items: [{ type: 'text/plain', getAsFile: () => null }],
      };
      fireEvent.paste(textarea, { clipboardData });
      expect(onImagesAttached).not.toHaveBeenCalled();
    });

    it('ignores paste when clipboard has no items', () => {
      const onImagesAttached = vi.fn();
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          onImagesAttached={onImagesAttached}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const textarea = getInput();
      fireEvent.paste(textarea, {
        clipboardData: { getData: () => '', items: null },
      });
      expect(onImagesAttached).not.toHaveBeenCalled();
    });

    it('ignores paste when generating', () => {
      const onImagesAttached = vi.fn();
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          onImagesAttached={onImagesAttached}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={true}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const textarea = getInput();
      const file = new File(['x'], 'img.png', { type: 'image/png' });
      const clipboardData = {
        getData: () => '',
        items: [{ type: 'image/png', getAsFile: () => file }],
      };
      fireEvent.paste(textarea, { clipboardData });
      expect(onImagesAttached).not.toHaveBeenCalled();
    });

    it('skips image items where getAsFile returns null', () => {
      const onImagesAttached = vi.fn();
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          onImagesAttached={onImagesAttached}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const textarea = getInput();
      const clipboardData = {
        getData: () => '',
        items: [{ type: 'image/png', getAsFile: () => null }],
      };
      fireEvent.paste(textarea, { clipboardData });
      expect(onImagesAttached).not.toHaveBeenCalled();
    });

    it('respects max image limit during paste', async () => {
      const onImagesAttached = vi.fn();
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          attachedImages={[
            makeImage({ id: 'a' }),
            makeImage({ id: 'b' }),
            makeImage({ id: 'c' }),
            makeImage({ id: 'd' }),
          ]}
          onImagesAttached={onImagesAttached}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const textarea = getInput();
      const file = new File(['x'], 'img.png', { type: 'image/png' });
      const clipboardData = {
        getData: () => '',
        items: [{ type: 'image/png', getAsFile: () => file }],
      };
      fireEvent.paste(textarea, { clipboardData });
      // Should not process since we're already at max.
      expect(onImagesAttached).not.toHaveBeenCalled();
    });
  });

  describe('screenshot button', () => {
    it('renders screenshot button with correct aria-label', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      expect(
        screen.getByRole('button', { name: 'Take screenshot' }),
      ).not.toBeNull();
    });

    it('calls onScreenshot when clicked', () => {
      const onScreenshot = vi.fn();
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          onScreenshot={onScreenshot}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Take screenshot' }));
      expect(onScreenshot).toHaveBeenCalledOnce();
    });

    it('is disabled while generating', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query=""
          setQuery={vi.fn()}
          isChatMode={true}
          isGenerating={true}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      expect(
        screen.getByRole('button', { name: 'Take screenshot' }),
      ).toBeDisabled();
    });

    it('is disabled while submit is pending', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query=""
          setQuery={vi.fn()}
          isChatMode={true}
          isGenerating={false}
          isSubmitPending={true}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      expect(
        screen.getByRole('button', { name: 'Take screenshot' }),
      ).toBeDisabled();
    });

    it('is disabled when max images are already attached', () => {
      const maxImages = [
        makeImage({ id: '1' }),
        makeImage({ id: '2' }),
        makeImage({ id: '3' }),
        makeImage({ id: '4' }),
      ];
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          attachedImages={maxImages}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      expect(
        screen.getByRole('button', { name: 'Take screenshot' }),
      ).toBeDisabled();
    });

    it('is enabled when fewer than max images are attached', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          attachedImages={[makeImage()]}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      expect(
        screen.getByRole('button', { name: 'Take screenshot' }),
      ).not.toBeDisabled();
    });

    it('renders in chat mode', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query=""
          setQuery={vi.fn()}
          isChatMode={true}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      expect(
        screen.getByRole('button', { name: 'Take screenshot' }),
      ).not.toBeNull();
    });

    it('has no hover classes when max images are attached', () => {
      const maxImages = [
        makeImage({ id: '1' }),
        makeImage({ id: '2' }),
        makeImage({ id: '3' }),
        makeImage({ id: '4' }),
      ];
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          attachedImages={maxImages}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const btn = screen.getByRole('button', { name: 'Take screenshot' });
      expect(btn.className).not.toContain('hover:text-primary');
      expect(btn.className).not.toContain('hover:bg-primary/10');
    });

    it('has hover classes when below max images', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          attachedImages={[makeImage()]}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const btn = screen.getByRole('button', { name: 'Take screenshot' });
      expect(btn.className).toContain('hover:text-primary');
      expect(btn.className).toContain('hover:bg-primary/10');
    });

    it('shows tooltip explaining limit when camera button is hovered at max images', () => {
      const maxImages = [
        makeImage({ id: '1' }),
        makeImage({ id: '2' }),
        makeImage({ id: '3' }),
        makeImage({ id: '4' }),
      ];
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          attachedImages={maxImages}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const btn = screen.getByRole('button', { name: 'Take screenshot' });
      fireEvent.mouseEnter(btn.parentElement!);
      expect(screen.getByText('Maximum 3 images attached')).toBeInTheDocument();
    });

    it('does not show max-images tooltip when below max images', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          attachedImages={[makeImage()]}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      expect(
        screen.queryByText('Maximum 3 images attached'),
      ).not.toBeInTheDocument();
    });

    it('shows screenshot tooltip on hover when below max images', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          attachedImages={[]}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const btn = screen.getByRole('button', { name: 'Take screenshot' });
      fireEvent.mouseEnter(btn.parentElement!);
      expect(screen.getByText('Take a screenshot')).toBeInTheDocument();
    });
  });

  describe('isSubmitPending state', () => {
    it('shows stop button when isSubmitPending is true', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          attachedImages={[makeImage({ id: 'img-1', filePath: null })]}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          isSubmitPending={true}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const btn = screen.getByRole('button', { name: /stop/i });
      expect(btn).toBeInTheDocument();
      expect(btn.classList.contains('stop-btn-ring')).toBe(true);
    });

    it('keeps the input editable when isSubmitPending is true', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          isSubmitPending={true}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      expect(getInput().getAttribute('contenteditable')).toBe('true');
    });

    it('ignores paste when isSubmitPending', () => {
      const onImagesAttached = vi.fn();
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          onImagesAttached={onImagesAttached}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          isSubmitPending={true}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const textarea = getInput();
      const file = new File(['x'], 'img.png', { type: 'image/png' });
      const clipboardData = {
        getData: () => '',
        items: [{ type: 'image/png', getAsFile: () => file }],
      };
      fireEvent.paste(textarea, { clipboardData });
      expect(onImagesAttached).not.toHaveBeenCalled();
    });
  });

  describe('command suggestion popover', () => {
    function renderWithQuery(query: string, busy = false) {
      const setQuery = vi.fn();
      const { rerender } = render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query={query}
          setQuery={setQuery}
          isChatMode={false}
          isGenerating={busy}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      return { setQuery, rerender };
    }

    it('shows CommandSuggestion when query starts with "/"', () => {
      renderWithQuery('/');
      expect(
        screen.getByRole('listbox', { name: /command suggestions/i }),
      ).toBeInTheDocument();
    });

    it('shows CommandSuggestion for partial trigger "/sc"', () => {
      renderWithQuery('/sc');
      expect(
        screen.getByRole('listbox', { name: /command suggestions/i }),
      ).toBeInTheDocument();
      expect(screen.getByText('/screen')).toBeInTheDocument();
    });

    it('shows /live stream and /live full subcommand rows when typing /live', () => {
      renderWithQuery('/live');
      const options = screen.getAllByRole('option');
      expect(options[0]).toHaveTextContent('/live');
      expect(options[0]).toHaveTextContent(
        'Toggle the live mascot talking-head video for replies',
      );
      expect(options[1]).toHaveTextContent('/live stream');
      expect(options[1]).toHaveTextContent(
        'Play reply segments as they generate (default)',
      );
      expect(options[2]).toHaveTextContent('/live full');
      expect(options[2]).toHaveTextContent(
        'Render the whole reply first, then play the complete video',
      );
    });

    it('suppresses live subcommands when /live is already used in the text', () => {
      renderWithQuery('/live /live');
      expect(screen.queryByText('/live stream')).toBeNull();
      expect(screen.queryByText('/live full')).toBeNull();
    });

    it('Tab on the /live stream subcommand completes it', () => {
      const setQuery = vi.fn();
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query="/live"
          setQuery={setQuery}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const textarea = getInput();
      // Rows: 0 = /live, 1 = /live stream, 2 = /live full.
      fireEvent.keyDown(textarea, { key: 'ArrowDown' });
      fireEvent.keyDown(textarea, { key: 'Tab' });
      expect(setQuery).toHaveBeenCalledWith('/live stream ');
    });

    it('does not show CommandSuggestion when query does not start with "/"', () => {
      renderWithQuery('hello');
      expect(
        screen.queryByRole('listbox', { name: /command suggestions/i }),
      ).toBeNull();
    });

    it('does not show CommandSuggestion when query has a space after the trigger', () => {
      renderWithQuery('/screen ');
      expect(
        screen.queryByRole('listbox', { name: /command suggestions/i }),
      ).toBeNull();
    });

    it('does not show CommandSuggestion when busy (generating)', () => {
      renderWithQuery('/screen', true);
      expect(
        screen.queryByRole('listbox', { name: /command suggestions/i }),
      ).toBeNull();
    });

    it('Tab key calls setQuery with trigger + space when suggestion is visible', () => {
      const setQuery = vi.fn();
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query="/sc"
          setQuery={setQuery}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const textarea = getInput();
      fireEvent.keyDown(textarea, { key: 'Tab' });
      expect(setQuery).toHaveBeenCalledWith('/screen ');
    });

    it('Enter on highlighted row completes the trigger instead of submitting', () => {
      const onSubmit = vi.fn();
      const setQuery = vi.fn();
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query="/sc"
          setQuery={setQuery}
          isChatMode={false}
          isGenerating={false}
          onSubmit={onSubmit}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const textarea = getInput();
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      expect(setQuery).toHaveBeenCalledWith('/screen ');
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('Enter submits when query exactly matches the highlighted trigger', () => {
      const onSubmit = vi.fn();
      const setQuery = vi.fn();
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query="/screen"
          setQuery={setQuery}
          isChatMode={false}
          isGenerating={false}
          onSubmit={onSubmit}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const textarea = getInput();
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      expect(onSubmit).toHaveBeenCalledOnce();
      expect(setQuery).not.toHaveBeenCalled();
    });

    it('Escape dismisses suggestions without changing query', () => {
      const setQuery = vi.fn();
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query="/sc"
          setQuery={setQuery}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const textarea = getInput();
      fireEvent.keyDown(textarea, { key: 'Escape' });
      // setQuery is NOT called (query is unchanged)
      expect(setQuery).not.toHaveBeenCalled();
      // Suggestion popover is no longer rendered
      expect(
        screen.queryByRole('listbox', { name: /command suggestions/i }),
      ).toBeNull();
    });

    it('ArrowDown moves highlight to next row', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query="/"
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const textarea = getInput();
      // Initially row 0 is highlighted (only one command, so index stays 0)
      fireEvent.keyDown(textarea, { key: 'ArrowDown' });
      // ArrowDown from index 0 moves to index 1
      const options = screen.getAllByRole('option');
      expect(options[1]).toHaveAttribute('aria-selected', 'true');
    });

    it('ArrowUp moves highlight to previous row (wraps)', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query="/"
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const textarea = getInput();
      fireEvent.keyDown(textarea, { key: 'ArrowUp' });
      // ArrowUp wraps to the last option
      const options = screen.getAllByRole('option');
      const lastOption = options[options.length - 1];
      expect(lastOption).toHaveAttribute('aria-selected', 'true');
    });

    it('clicking a suggestion row calls setQuery with trigger + space', () => {
      const setQuery = vi.fn();
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query="/"
          setQuery={setQuery}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const options = screen.getAllByRole('option');
      fireEvent.mouseDown(options[0]);
      expect(setQuery).toHaveBeenCalledWith('/search ');
    });

    it('Tab does nothing when suggestions are not shown', () => {
      const onSubmit = vi.fn();
      const setQuery = vi.fn();
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query="hello"
          setQuery={setQuery}
          isChatMode={false}
          isGenerating={false}
          onSubmit={onSubmit}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const textarea = getInput();
      fireEvent.keyDown(textarea, { key: 'Tab' });
      expect(setQuery).not.toHaveBeenCalled();
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('Escape does nothing when suggestions are not shown', () => {
      const setQuery = vi.fn();
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query="hello"
          setQuery={setQuery}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const textarea = getInput();
      fireEvent.keyDown(textarea, { key: 'Escape' });
      expect(setQuery).not.toHaveBeenCalled();
    });

    it('shows "No commands found" when prefix matches nothing', () => {
      renderWithQuery('/xyz');
      expect(screen.getByText('No commands found')).toBeInTheDocument();
    });

    it('Enter falls through to submit when suggestion list is empty', () => {
      const onSubmit = vi.fn();
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query="/xyz"
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={onSubmit}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const textarea = getInput();
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
      expect(onSubmit).toHaveBeenCalledOnce();
    });

    it('ArrowDown and ArrowUp do nothing when filtered list is empty', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query="/xyz"
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const textarea = getInput();
      // Should not throw
      fireEvent.keyDown(textarea, { key: 'ArrowDown' });
      fireEvent.keyDown(textarea, { key: 'ArrowUp' });
      // Still shows "No commands found"
      expect(screen.getByText('No commands found')).toBeInTheDocument();
    });

    it('Tab does nothing when filtered list is empty', () => {
      const setQuery = vi.fn();
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query="/xyz"
          setQuery={setQuery}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const textarea = getInput();
      fireEvent.keyDown(textarea, { key: 'Tab' });
      expect(setQuery).not.toHaveBeenCalled();
    });

    describe('used-command word boundaries', () => {
      it('treats a mid-text command preceded by a space as used', () => {
        renderWithQuery('hello /search /sc');
        // "/search" appears before the active "/sc" prefix, so it is excluded
        // from the suggestions even though it shares the "/se" stem.
        const options = screen.getAllByRole('option');
        expect(options).toHaveLength(1);
        expect(options[0].textContent).toContain('/screen');
      });

      it('does not treat a command embedded mid-word as used', () => {
        renderWithQuery('hello/search /sea');
        // "hello/search" is not a real command usage (no space before the
        // trigger), so /search stays eligible and both /search + /searchimage
        // show under the "/sea" prefix.
        const options = screen.getAllByRole('option');
        expect(options).toHaveLength(2);
        expect(options[0].textContent).toContain('/search');
        expect(options[1].textContent).toContain('/searchimage');
      });

      it('treats a trigger glued to following text as unused at position 0', () => {
        renderWithQuery('/searchx /sea');
        // "/search" sits at index 0 but is followed by "x", so the after-bound
        // check fails and the trigger is not counted as used.
        const options = screen.getAllByRole('option');
        expect(options).toHaveLength(2);
        expect(options[0].textContent).toContain('/search');
        expect(options[1].textContent).toContain('/searchimage');
      });

      it('treats a command followed by a space in mid-text as used', () => {
        renderWithQuery('hello /search cats /sea');
        // "/search" is a complete word in the middle of the text; it must be
        // excluded from the "/sea" suggestions.
        const options = screen.getAllByRole('option');
        expect(options).toHaveLength(1);
        expect(options[0].textContent).toContain('/searchimage');
      });
    });
  });

  describe('capability gate UI', () => {
    it('renders the capability mismatch strip when message provided', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
          capabilityConflictMessage="llama3 can't see images."
        />,
      );
      expect(screen.getByTestId('capability-mismatch-strip')).toHaveTextContent(
        "llama3 can't see images.",
      );
    });

    it('omits the strip when message is null', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
          capabilityConflictMessage={null}
        />,
      );
      expect(screen.queryByTestId('capability-mismatch-strip')).toBeNull();
    });

    it('mounts the shake animation branch when shake is true', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
          shake
        />,
      );
      expect(screen.getByTestId('ask-bar-row')).toBeInTheDocument();
    });

    it('keeps the no-shake branch when shake is false', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
          shake={false}
        />,
      );
      expect(screen.getByTestId('ask-bar-row')).toBeInTheDocument();
    });
  });

  describe('auto-prime-skipped strip', () => {
    const skippedProps = {
      modelName: 'Qwen3.5 9B',
      requiredBytes: 5 * 1024 ** 3,
      availableBytes: 2 * 1024 ** 3,
      ceilingFraction: 0.8,
      canRemember: true,
      onSwitchModel: vi.fn(),
      onLoadAnyway: vi.fn(),
    };

    it('renders the strip in ask-bar mode when autoPrimeSkipped is provided', () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
          autoPrimeSkipped={skippedProps}
        />,
      );
      expect(
        screen.getByTestId('auto-prime-skipped-strip'),
      ).toBeInTheDocument();
    });

    it('hides the strip in chat mode even when autoPrimeSkipped is provided', () => {
      // Once a real chat turn starts, the per-message InsufficientMemory error
      // card takes over as the surface for the same refusal.
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query=""
          setQuery={vi.fn()}
          isChatMode={true}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
          autoPrimeSkipped={skippedProps}
        />,
      );
      expect(screen.queryByTestId('auto-prime-skipped-strip')).toBeNull();
    });
  });

  describe('slash command highlighting', () => {
    it('highlights a recognized command token in violet within the input', async () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query="/search what is Rust?"
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const input = getInput();
      await waitFor(() => {
        expect(input.querySelector('.text-violet-400')?.textContent).toBe(
          '/search',
        );
      });
    });

    it('does not highlight a trigger embedded in a longer word', async () => {
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query="/searching"
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      const input = getInput();
      await waitFor(() => expect(input.textContent).toContain('/searching'));
      expect(input.querySelector('.text-violet-400')).toBeNull();
    });
  });

  describe('onFirstKeystroke', () => {
    it('fires when the editor transitions from empty to non-empty', async () => {
      const onFirstKeystroke = vi.fn();
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query=""
          setQuery={vi.fn()}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
          onFirstKeystroke={onFirstKeystroke}
        />,
      );
      typeText('h');
      await waitFor(() => expect(onFirstKeystroke).toHaveBeenCalledTimes(1));
    });

    it('does not fire on subsequent edits when the query is already non-empty', async () => {
      const onFirstKeystroke = vi.fn();
      const setQuery = vi.fn();
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query="h"
          setQuery={setQuery}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
          onFirstKeystroke={onFirstKeystroke}
        />,
      );
      typeText('he');
      await waitFor(() => expect(setQuery).toHaveBeenCalledWith('he'));
      expect(onFirstKeystroke).not.toHaveBeenCalled();
    });

    it('does not throw when omitted', async () => {
      const setQuery = vi.fn();
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          query=""
          setQuery={setQuery}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      typeText('h');
      await waitFor(() => expect(setQuery).toHaveBeenCalledWith('h'));
    });
  });

  describe('search trust notice', () => {
    beforeEach(() => {
      invoke.mockClear();
    });

    /**
     * Renders AskBarView with DEFAULT_CONFIG-style behavior overrides.
     */
    function renderWithBehavior(
      behavior: Partial<(typeof DEFAULT_CONFIG)['behavior']>,
      props: Partial<React.ComponentProps<typeof AskBarView>> = {},
    ) {
      return render(
        <ConfigProviderForTest
          value={{
            ...DEFAULT_CONFIG,
            behavior: {
              ...DEFAULT_CONFIG.behavior,
              ...behavior,
            },
          }}
        >
          <AskBarView
            {...IMAGE_DEFAULTS}
            query=""
            setQuery={vi.fn()}
            isChatMode={false}
            isGenerating={false}
            onSubmit={vi.fn()}
            onCancel={vi.fn()}
            inputRef={makeRef()}
            {...props}
          />
        </ConfigProviderForTest>,
      );
    }

    it('shows footer notice below the input row when autoSearch on and not acknowledged', () => {
      renderWithBehavior({
        autoSearch: true,
        searchNoticeAcknowledged: false,
      });
      const notice = screen.getByTestId('version-announcement');
      expect(notice).toBeInTheDocument();
      expect(
        screen.getByTestId('version-announcement-slot'),
      ).toBeInTheDocument();
      // Design D: below the logo/input row in DOM order.
      const row = screen.getByTestId('ask-bar-row');
      expect(
        row.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it('shows notice in chat mode when ask bar still mounts', () => {
      renderWithBehavior(
        { autoSearch: true, searchNoticeAcknowledged: false },
        { isChatMode: true },
      );
      expect(screen.getByTestId('version-announcement')).toBeInTheDocument();
    });

    it('hides notice when searchNoticeAcknowledged is true', () => {
      renderWithBehavior({
        autoSearch: true,
        searchNoticeAcknowledged: true,
      });
      expect(screen.queryByTestId('version-announcement')).toBeNull();
    });

    it('shows notice when autoSearch is false with Turn on in Settings CTA', () => {
      renderWithBehavior({
        autoSearch: false,
        searchNoticeAcknowledged: false,
      });
      expect(screen.getByTestId('version-announcement')).toBeInTheDocument();
      expect(screen.getByText('Turn on in Settings')).toBeInTheDocument();
      expect(screen.queryByText('Turn off in Settings')).toBeNull();
    });

    it('Acknowledge persists search_notice_acknowledged and hides the notice', () => {
      renderWithBehavior({
        autoSearch: true,
        searchNoticeAcknowledged: false,
      });
      fireEvent.click(screen.getByTestId('version-announcement-primary'));
      expect(invoke).toHaveBeenCalledWith('set_config_field', {
        section: 'behavior',
        key: 'search_notice_acknowledged',
        value: true,
      });
      expect(screen.queryByTestId('version-announcement')).toBeNull();
    });

    it('restores the notice when the acknowledgement write fails', async () => {
      invoke.mockImplementation(async (cmd: string) => {
        if (cmd === 'set_config_field') {
          throw new Error('write failed');
        }
        return undefined;
      });
      renderWithBehavior({
        autoSearch: true,
        searchNoticeAcknowledged: false,
      });
      fireEvent.click(screen.getByTestId('version-announcement-primary'));
      // The optimistic hide must roll back so the acknowledgement is not lost.
      await waitFor(() =>
        expect(screen.getByTestId('version-announcement')).toBeInTheDocument(),
      );
    });

    it('Turn off in Settings opens Behavior deep-link without flipping auto_search', () => {
      renderWithBehavior({
        autoSearch: true,
        searchNoticeAcknowledged: false,
      });
      fireEvent.click(screen.getByTestId('version-announcement-secondary'));
      expect(invoke).toHaveBeenCalledWith('open_settings_to_behavior');
      expect(invoke).not.toHaveBeenCalledWith(
        'set_config_field',
        expect.objectContaining({ key: 'auto_search' }),
      );
    });

    it('does not disable compose or send while notice is visible', () => {
      renderWithBehavior(
        { autoSearch: true, searchNoticeAcknowledged: false },
        { query: 'hello' },
      );
      expect(screen.getByTestId('version-announcement')).toBeInTheDocument();
      const input = getInput();
      expect(input.getAttribute('contenteditable')).toBe('true');
      expect(
        screen.getByRole('button', { name: 'Send message' }),
      ).not.toBeDisabled();
    });
  });

  describe('native clipboard paste (Ctrl+V)', () => {
    let blob: Blob | null = null;
    const putImageData = vi.fn();

    beforeEach(() => {
      readImageMock.mockReset();
      readTextMock.mockReset();
      // Stub the offscreen canvas used by rgbaToPngFile: a fake 2D context plus
      // a toBlob that hands back the per-test blob.
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
        createImageData: (w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4),
        }),
        putImageData,
      } as unknown as CanvasRenderingContext2D);
      vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
        (cb: BlobCallback) => {
          cb(blob);
        },
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
      // setup.ts defines navigator.clipboard (non-configurable), so only the
      // per-test `read` stub is removed here.
      delete (navigator.clipboard as { read?: unknown }).read;
    });

    function renderBar() {
      const onImagesAttached = vi.fn<(files: File[]) => void>();
      const setQuery = vi.fn<React.Dispatch<React.SetStateAction<string>>>();
      render(
        <AskBarView
          {...IMAGE_DEFAULTS}
          onImagesAttached={onImagesAttached}
          query=""
          setQuery={setQuery}
          isChatMode={false}
          isGenerating={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          inputRef={makeRef()}
        />,
      );
      return { onImagesAttached, setQuery };
    }

    /** Simulates pressing Ctrl+V, which Lexical routes to nativeClipboardPaste. */
    function fireCtrlV() {
      act(() => {
        getEditor().dispatchCommand(KEY_DOWN_COMMAND, {
          ctrlKey: true,
          key: 'v',
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
        } as unknown as KeyboardEvent);
      });
    }

    /** Stubs navigator.clipboard.read (setup.ts defines the clipboard object
     *  as non-configurable, so we add the `read` method onto it) and returns
     *  the mock for awaiting. */
    function mockClipboardRead(
      items: Array<{ types: string[]; getType: (t: string) => Promise<Blob> }>,
    ) {
      const read = vi.fn(async () => items);
      Object.defineProperty(navigator.clipboard, 'read', {
        configurable: true,
        writable: true,
        value: read,
      });
      return read;
    }

    it('attaches a PNG file when the native clipboard holds an image', async () => {
      readImageMock.mockResolvedValue({
        size: async () => ({ width: 2, height: 2 }),
        rgba: async () => new Uint8Array(16),
      });
      blob = new Blob([new Uint8Array(16)], { type: 'image/png' });

      const { onImagesAttached } = renderBar();
      fireCtrlV();

      await waitFor(() => expect(onImagesAttached).toHaveBeenCalledTimes(1));
      const [files] = onImagesAttached.mock.calls[0] as [File[]];
      expect(files[0].type).toBe('image/png');
      expect(readTextMock).not.toHaveBeenCalled();
    });

    it('falls back to text when the native image exceeds the size cap', async () => {
      readImageMock.mockResolvedValue({
        size: async () => ({ width: 2, height: 2 }),
        rgba: async () => new Uint8Array(16),
      });
      blob = new Blob([new Uint8Array(MAX_IMAGE_SIZE_BYTES + 1)]);
      readTextMock.mockResolvedValue('pasted fallback text');

      const { onImagesAttached, setQuery } = renderBar();
      fireCtrlV();

      await waitFor(() =>
        expect(setQuery).toHaveBeenCalledWith('pasted fallback text'),
      );
      expect(onImagesAttached).not.toHaveBeenCalled();
    });

    it('skips a zero-width native image and falls through', async () => {
      readImageMock.mockResolvedValue({
        size: async () => ({ width: 0, height: 0 }),
        rgba: async () => new Uint8Array(16),
      });
      readTextMock.mockResolvedValue(null);

      const { onImagesAttached } = renderBar();
      fireCtrlV();

      await waitFor(() => expect(readTextMock).toHaveBeenCalled());
      expect(onImagesAttached).not.toHaveBeenCalled();
    });

    it('skips a zero-height native image and falls through', async () => {
      readImageMock.mockResolvedValue({
        size: async () => ({ width: 2, height: 0 }),
        rgba: async () => new Uint8Array(16),
      });
      readTextMock.mockResolvedValue(null);

      const { onImagesAttached } = renderBar();
      fireCtrlV();

      await waitFor(() => expect(readTextMock).toHaveBeenCalled());
      expect(onImagesAttached).not.toHaveBeenCalled();
    });

    it('skips a native image with no pixel data and falls through', async () => {
      readImageMock.mockResolvedValue({
        size: async () => ({ width: 2, height: 2 }),
        rgba: async () => new Uint8Array(0),
      });
      readTextMock.mockResolvedValue(null);

      const { onImagesAttached } = renderBar();
      fireCtrlV();

      await waitFor(() => expect(readTextMock).toHaveBeenCalled());
      expect(onImagesAttached).not.toHaveBeenCalled();
    });

    it('uses the native text clipboard when no image is present', async () => {
      readImageMock.mockResolvedValue(null);
      readTextMock.mockResolvedValue('hello from clipboard');

      const { onImagesAttached, setQuery } = renderBar();
      fireCtrlV();

      await waitFor(() =>
        expect(setQuery).toHaveBeenCalledWith('hello from clipboard'),
      );
      expect(onImagesAttached).not.toHaveBeenCalled();
    });

    it('recovers from a failing native image read via the text clipboard', async () => {
      readImageMock.mockRejectedValue(new Error('clipboard plugin missing'));
      readTextMock.mockResolvedValue('recovered text');

      const { onImagesAttached, setQuery } = renderBar();
      fireCtrlV();

      await waitFor(() =>
        expect(setQuery).toHaveBeenCalledWith('recovered text'),
      );
      expect(onImagesAttached).not.toHaveBeenCalled();
    });

    it('inserts text at the end when the editor has no active selection', async () => {
      readImageMock.mockRejectedValue(new Error('clipboard plugin missing'));
      readTextMock.mockResolvedValue('no-selection paste');

      const { onImagesAttached, setQuery } = renderBar();
      // Stub getSelection() to return null so Lexical's $internalCreateSelection
      // can never re-derive a selection from the DOM during the async paste
      // pipeline. $getSelection() then returns null inside the insert update and
      // the readText fallback takes the selectEnd() branch.
      const originalGetSelection = window.getSelection;
      window.getSelection = () => null;
      try {
        fireCtrlV();
        await Promise.resolve();
        await Promise.resolve();
      } finally {
        window.getSelection = originalGetSelection;
      }

      await waitFor(() =>
        expect(setQuery).toHaveBeenCalledWith('no-selection paste'),
      );
      expect(onImagesAttached).not.toHaveBeenCalled();
    });

    it('ignores an empty native text clipboard', async () => {
      readImageMock.mockRejectedValue(new Error('clipboard plugin missing'));
      readTextMock.mockResolvedValue('');

      const { onImagesAttached } = renderBar();
      fireCtrlV();

      await waitFor(() => expect(readTextMock).toHaveBeenCalled());
      expect(onImagesAttached).not.toHaveBeenCalled();
    });

    it('swallows a failing native text read', async () => {
      readImageMock.mockRejectedValue(new Error('clipboard plugin missing'));
      readTextMock.mockRejectedValue(new Error('text read failed'));

      const { onImagesAttached } = renderBar();
      fireCtrlV();

      await waitFor(() => expect(readTextMock).toHaveBeenCalled());
      expect(onImagesAttached).not.toHaveBeenCalled();
    });

    it('falls back to the DOM clipboard API for images', async () => {
      const small = new Blob([new Uint8Array(8)], { type: 'image/png' });
      const read = mockClipboardRead([
        { types: ['image/png'], getType: async () => small },
      ]);
      readImageMock.mockRejectedValue(new Error('plugin missing'));
      readTextMock.mockResolvedValue('');

      const { onImagesAttached } = renderBar();
      fireCtrlV();

      await waitFor(() => expect(read).toHaveBeenCalled());
      expect(onImagesAttached).toHaveBeenCalledTimes(1);
      const [files] = onImagesAttached.mock.calls[0] as [File[]];
      expect(files[0].type).toBe('image/png');
    });

    it('skips DOM clipboard images over the size cap', async () => {
      const huge = new Blob([new Uint8Array(MAX_IMAGE_SIZE_BYTES + 1)], {
        type: 'image/png',
      });
      const read = mockClipboardRead([
        { types: ['image/png'], getType: async () => huge },
      ]);
      readImageMock.mockRejectedValue(new Error('plugin missing'));
      readTextMock.mockResolvedValue('');

      const { onImagesAttached } = renderBar();
      fireCtrlV();

      await waitFor(() => expect(read).toHaveBeenCalled());
      expect(onImagesAttached).not.toHaveBeenCalled();
    });

    it('ignores non-image DOM clipboard entries', async () => {
      const read = mockClipboardRead([
        { types: [], getType: vi.fn() },
        { types: ['text/plain'], getType: vi.fn() },
      ]);
      readImageMock.mockRejectedValue(new Error('plugin missing'));
      readTextMock.mockResolvedValue('');

      const { onImagesAttached } = renderBar();
      fireCtrlV();

      await waitFor(() => expect(read).toHaveBeenCalled());
      expect(onImagesAttached).not.toHaveBeenCalled();
    });

    it('ignores an empty DOM clipboard item list', async () => {
      const read = mockClipboardRead([]);
      readImageMock.mockRejectedValue(new Error('plugin missing'));
      readTextMock.mockResolvedValue('');

      const { onImagesAttached } = renderBar();
      fireCtrlV();

      await waitFor(() => expect(read).toHaveBeenCalled());
      expect(onImagesAttached).not.toHaveBeenCalled();
    });

    it('swallows a failing DOM clipboard read', async () => {
      const read = vi.fn(async () => {
        throw new Error('permission denied');
      });
      Object.defineProperty(navigator.clipboard, 'read', {
        configurable: true,
        writable: true,
        value: read,
      });
      readImageMock.mockRejectedValue(new Error('plugin missing'));
      readTextMock.mockResolvedValue('');

      const { onImagesAttached } = renderBar();
      fireCtrlV();

      await waitFor(() => expect(read).toHaveBeenCalled());
      expect(onImagesAttached).not.toHaveBeenCalled();
    });
  });
});
