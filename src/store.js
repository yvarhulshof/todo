// Reactive state container.
//
// Undo is snapshot-based rather than inverse-operation based: before every
// mutation we clone the document. It costs a few hundred microseconds on
// realistic data and removes an entire category of "undo restored the wrong
// thing" bugs.

const UNDO_LIMIT = 50;

export class Store extends EventTarget {
  constructor(data, persistence) {
    super();
    this.data = data;
    this.persistence = persistence;
    this.undoStack = [];
    this.redoStack = [];
    // Ephemeral, never persisted.
    this.ui = {
      view: { kind: 'all' },
      search: '',
      selectedId: null,
      editingId: null,
      expandedId: null,
      completedOpen: false,
      dragging: false,
      labelEditorOpen: false,
    };
  }

  clone(data = this.data) {
    return typeof structuredClone === 'function'
      ? structuredClone(data)
      : JSON.parse(JSON.stringify(data));
  }

  /**
   * Apply a mutation to the document.
   * @param {(data: object) => any} mutator
   * @param {{undoLabel?: string, silent?: boolean}} options
   *   undoLabel marks the change undoable and names it for the toast.
   */
  commit(mutator, { undoLabel = null, silent = false } = {}) {
    const before = undoLabel ? this.clone() : null;
    const result = mutator(this.data);

    if (undoLabel) {
      this.undoStack.push({ label: undoLabel, data: before });
      if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
      this.redoStack.length = 0;
    }

    this.persistence?.save(this.data);
    if (!silent) this.emit();
    return result;
  }

  /** Change ephemeral UI state. Never touches the document or undo. */
  setUI(patch, { silent = false } = {}) {
    Object.assign(this.ui, patch);
    if (!silent) this.emit();
  }

  /** Persisted preferences are part of the document but never undoable. */
  setPref(patch) {
    Object.assign(this.data.prefs, patch);
    this.persistence?.save(this.data);
    this.emit();
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  undo() {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push({ label: entry.label, data: this.clone() });
    this.data = entry.data;
    this.persistence?.save(this.data);
    this.emit();
    return entry.label;
  }

  redo() {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push({ label: entry.label, data: this.clone() });
    this.data = entry.data;
    this.persistence?.save(this.data);
    this.emit();
    return entry.label;
  }

  /** Replace the whole document (import, file reconnect, snapshot restore). */
  replace(data, { undoLabel = null } = {}) {
    if (undoLabel) {
      this.undoStack.push({ label: undoLabel, data: this.clone() });
      this.redoStack.length = 0;
    }
    this.data = data;
    this.persistence?.save(this.data);
    this.emit();
  }

  emit() {
    this.dispatchEvent(new CustomEvent('change'));
  }

  subscribe(fn) {
    this.addEventListener('change', fn);
    return () => this.removeEventListener('change', fn);
  }
}
