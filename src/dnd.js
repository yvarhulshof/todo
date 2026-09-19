// Drag and drop, using native HTML5 DnD so it works without a library.
//
// Four kinds of drop target:
//   - another todo   -> reorder (and adopt that row's list/label context)
//   - a group header -> reassign the label (this is the relabel gesture)
//   - a sidebar row  -> move between lists, or set a due date on a smart view
//   - another group header -> reorder the label groups themselves
//
// A todo drag and a group-header drag are tracked separately (`todoId` vs
// `labelId`) so the two gestures on the same `.group__head` element — "drop a
// todo here to relabel" and "drag this header to reorder groups" — never get
// confused for one another.

export const dragState = { todoId: null, labelId: null };

const TYPE = 'application/x-todo-id';
const GROUP_TYPE = 'application/x-label-id';

function clearMarks() {
  document
    .querySelectorAll('.is-drop-before, .is-drop-after, .is-drop-target')
    .forEach((n) => n.classList.remove('is-drop-before', 'is-drop-after', 'is-drop-target'));
}

export function makeDraggable(node, todoId, enabled) {
  if (!enabled) {
    node.draggable = false;
    return;
  }
  node.draggable = true;
  node.addEventListener('dragstart', (event) => {
    dragState.todoId = todoId;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(TYPE, todoId);
    // Some browsers require a text/plain payload to start a drag at all.
    event.dataTransfer.setData('text/plain', todoId);
    requestAnimationFrame(() => node.classList.add('is-dragging'));
  });
  node.addEventListener('dragend', () => {
    dragState.todoId = null;
    node.classList.remove('is-dragging');
    clearMarks();
  });
}

/**
 * A todo row as a reorder target. `onDrop(draggedId, beforeId)` receives the
 * id the dragged todo should be placed before, or null for "after this one,
 * at the end".
 */
export function makeReorderTarget(node, todoId, nextId, onDrop) {
  node.addEventListener('dragover', (event) => {
    if (!dragState.todoId || dragState.todoId === todoId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const rect = node.getBoundingClientRect();
    const above = event.clientY < rect.top + rect.height / 2;
    node.classList.toggle('is-drop-before', above);
    node.classList.toggle('is-drop-after', !above);
  });

  node.addEventListener('dragleave', () => {
    node.classList.remove('is-drop-before', 'is-drop-after');
  });

  node.addEventListener('drop', (event) => {
    const dragged = dragState.todoId || event.dataTransfer.getData(TYPE);
    if (!dragged || dragged === todoId) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = node.getBoundingClientRect();
    const above = event.clientY < rect.top + rect.height / 2;
    // Clear the flag *before* committing: renders are suppressed while a drag
    // is in flight, and `dragend` does not fire until after the drop handler.
    dragState.todoId = null;
    clearMarks();
    onDrop(dragged, above ? todoId : nextId);
  });
}

/** A container or header that accepts a todo as a whole (list, label group). */
export function makeZoneTarget(node, onDrop) {
  node.addEventListener('dragover', (event) => {
    if (!dragState.todoId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    node.classList.add('is-drop-target');
  });

  node.addEventListener('dragleave', (event) => {
    if (!node.contains(event.relatedTarget)) node.classList.remove('is-drop-target');
  });

  node.addEventListener('drop', (event) => {
    const dragged = dragState.todoId || event.dataTransfer.getData(TYPE);
    if (!dragged) return;
    event.preventDefault();
    dragState.todoId = null;
    clearMarks();
    onDrop(dragged);
  });
}

/** A group header picked up as the drag source, to reorder label groups. */
export function makeGroupDraggable(node, labelId, enabled) {
  if (!enabled) {
    node.draggable = false;
    return;
  }
  node.draggable = true;
  node.addEventListener('dragstart', (event) => {
    dragState.labelId = labelId;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(GROUP_TYPE, labelId);
    event.dataTransfer.setData('text/plain', labelId);
    requestAnimationFrame(() => node.classList.add('is-dragging'));
  });
  node.addEventListener('dragend', () => {
    dragState.labelId = null;
    node.classList.remove('is-dragging');
    clearMarks();
  });
}

/**
 * A group header as a reorder target for other group headers.
 * `onDrop(draggedLabelId, beforeId)` mirrors `makeReorderTarget`.
 */
export function makeGroupReorderTarget(node, labelId, nextLabelId, onDrop) {
  node.addEventListener('dragover', (event) => {
    if (!dragState.labelId || dragState.labelId === labelId) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    const rect = node.getBoundingClientRect();
    const above = event.clientY < rect.top + rect.height / 2;
    node.classList.toggle('is-drop-before', above);
    node.classList.toggle('is-drop-after', !above);
  });

  node.addEventListener('dragleave', () => {
    node.classList.remove('is-drop-before', 'is-drop-after');
  });

  node.addEventListener('drop', (event) => {
    const dragged = dragState.labelId;
    if (!dragged || dragged === labelId) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = node.getBoundingClientRect();
    const above = event.clientY < rect.top + rect.height / 2;
    dragState.labelId = null;
    clearMarks();
    onDrop(dragged, above ? labelId : nextLabelId);
  });
}
