import { el } from '../dom.js';
import { LABEL_COLORS } from '../model.js';

/**
 * Build a <dialog>, show it modally, resolve with whatever `onSubmit` returns.
 * `body` may be an array of nodes, or a function receiving `close` so a body
 * button can resolve the dialog directly.
 */
export function openDialog({
  title,
  description,
  body = [],
  confirmLabel = 'Save',
  cancelLabel = 'Cancel',
  danger = false,
  onSubmit,
  extraAction = null,
  hideConfirm = false,
}) {
  return new Promise((resolve) => {
    const form = el('form', { method: 'dialog' });
    const dialog = el('dialog', {}, [form]);

    let settled = false;
    function close(value) {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      resolve(value);
    }

    const nodes = typeof body === 'function' ? body(close) : body;

    form.append(
      el('div', { class: 'dialog__head' }, [el('h2', { class: 'dialog__title', text: title })]),
      el('div', { class: 'dialog__body' }, [
        description && el('p', { class: 'dialog__desc', text: description }),
        ...nodes,
      ]),
      el('div', { class: 'dialog__foot' }, [
        extraAction &&
          el('button', {
            class: `btn ${extraAction.danger ? 'btn--danger' : ''}`,
            type: 'button',
            style: { marginRight: 'auto' },
            onclick: () => close(extraAction.value),
          }, [extraAction.label]),
        el('button', { class: 'btn', type: 'button', onclick: () => close(null) }, [cancelLabel]),
        !hideConfirm &&
          el('button', {
            class: `btn ${danger ? 'btn--danger' : 'btn--primary'}`,
            type: 'submit',
          }, [confirmLabel]),
      ]),
    );
    function close(value) {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      resolve(value);
    }

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      close(onSubmit ? onSubmit(dialog) : true);
    });

    // Esc, and clicking the backdrop, both cancel.
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      close(null);
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) close(null);
    });

    document.body.append(dialog);
    dialog.showModal();
    dialog.querySelector('input, select, textarea')?.focus();
    dialog.querySelector('input')?.select?.();
  });
}

export function confirmDialog({ title, description, confirmLabel = 'Confirm', danger = true }) {
  return openDialog({ title, description, confirmLabel, danger, onSubmit: () => true });
}

/**
 * Shown at startup when the browser dropped file permission on the last
 * session's file. A corner indicator is easy to miss entirely, and silent
 * data loss is the one thing the save status must never risk — so this one
 * interrupts with a centered, modal dialog instead.
 */
export function disconnectedDialog(fileName) {
  return openDialog({
    title: `Disconnected from ${fileName}`,
    description:
      `The browser dropped its permission to save to ${fileName} when this tab last closed. ` +
      'Your todos are safe in this browser, but changes will not reach the file until you reconnect.',
    confirmLabel: 'Reconnect',
    cancelLabel: 'Not now',
    onSubmit: () => true,
  });
}

export function promptDialog({ title, description, label, value = '', confirmLabel = 'Save', placeholder = '' }) {
  const input = el('input', { type: 'text', value, placeholder, required: true, maxLength: 200 });
  return openDialog({
    title,
    description,
    confirmLabel,
    body: [el('div', { class: 'field' }, [el('label', { class: 'field__label', text: label }), input])],
    onSubmit: () => input.value.trim() || null,
  });
}

/**
 * Deleting a list must never silently destroy its todos, so the choice of
 * where they go is the dialog's whole purpose.
 */
export function deleteListDialog({ list, otherLists, todoCount }) {
  if (todoCount === 0) {
    return confirmDialog({
      title: `Delete "${list.name}"?`,
      description: 'This list is empty.',
      confirmLabel: 'Delete list',
    }).then((ok) => (ok ? { reassignTo: null } : null));
  }

  const select = el('select', {}, [
    ...otherLists.map((l) => el('option', { value: l.id, text: `Move to ${l.name}` })),
    el('option', { value: '__delete__', text: `Delete all ${todoCount} todos` }),
  ]);

  return openDialog({
    title: `Delete "${list.name}"?`,
    description: `It holds ${todoCount} ${todoCount === 1 ? 'todo' : 'todos'}. Choose what happens to them.`,
    confirmLabel: 'Delete list',
    danger: true,
    body: [
      el('div', { class: 'field' }, [
        el('label', { class: 'field__label', text: 'Its todos' }),
        select,
      ]),
    ],
    onSubmit: () => ({ reassignTo: select.value === '__delete__' ? null : select.value }),
  });
}

export function labelDialog({ title = 'New label', name = '', color = LABEL_COLORS[0].id } = {}) {
  const input = el('input', { type: 'text', value: name, required: true, maxLength: 40, placeholder: 'urgent' });
  let chosen = color;

  const swatches = LABEL_COLORS.map((c) =>
    el('button', {
      type: 'button',
      class: 'swatch',
      style: { background: c.hex },
      'aria-label': c.id,
      'aria-pressed': String(c.id === chosen),
      onclick: (event) => {
        chosen = c.id;
        event.currentTarget.parentElement
          .querySelectorAll('.swatch')
          .forEach((s) => s.setAttribute('aria-pressed', String(s.getAttribute('aria-label') === c.id)));
      },
    }),
  );

  return openDialog({
    title,
    confirmLabel: 'Save label',
    body: [
      el('div', { class: 'field' }, [el('label', { class: 'field__label', text: 'Name' }), input]),
      el('div', { class: 'field' }, [
        el('span', { class: 'field__label', text: 'Colour' }),
        el('div', { class: 'swatches' }, swatches),
      ]),
    ],
    onSubmit: () => {
      const clean = input.value.trim();
      return clean ? { name: clean, color: chosen } : null;
    },
  });
}

/** One dialog for renaming or deleting a list, rather than two in sequence. */
export function listSettingsDialog({ list, otherLists, todoCount }) {
  const input = el('input', { type: 'text', value: list.name, required: true, maxLength: 100 });
  const canDelete = otherLists.length > 0;

  return openDialog({
    title: 'List settings',
    body: [
      el('div', { class: 'field' }, [
        el('label', { class: 'field__label', text: 'Name' }),
        input,
      ]),
      el('p', {
        class: 'dialog__desc',
        text: `${todoCount} ${todoCount === 1 ? 'todo' : 'todos'} in this list.`,
      }),
      !canDelete &&
        el('p', { class: 'dialog__desc', text: 'This is your only list, so it cannot be deleted.' }),
    ],
    extraAction: canDelete ? { label: 'Delete list', danger: true, value: { action: 'delete' } } : null,
    confirmLabel: 'Save',
    onSubmit: () => {
      const clean = input.value.trim();
      return clean ? { action: 'rename', name: clean } : null;
    },
  });
}

/** Same idea for labels. Deleting one never deletes its todos. */
export function labelSettingsDialog({ label, todoCount }) {
  const input = el('input', { type: 'text', value: label.name, required: true, maxLength: 40 });
  let chosen = label.color;

  const swatches = LABEL_COLORS.map((c) =>
    el('button', {
      type: 'button',
      class: 'swatch',
      style: { background: c.hex },
      'aria-label': c.id,
      'aria-pressed': String(c.id === chosen),
      onclick: (event) => {
        chosen = c.id;
        event.currentTarget.parentElement
          .querySelectorAll('.swatch')
          .forEach((s) => s.setAttribute('aria-pressed', String(s.getAttribute('aria-label') === c.id)));
      },
    }),
  );

  return openDialog({
    title: 'Label settings',
    body: [
      el('div', { class: 'field' }, [el('label', { class: 'field__label', text: 'Name' }), input]),
      el('div', { class: 'field' }, [
        el('span', { class: 'field__label', text: 'Colour' }),
        el('div', { class: 'swatches' }, swatches),
      ]),
      el('p', {
        class: 'dialog__desc',
        text: `Used by ${todoCount} ${todoCount === 1 ? 'todo' : 'todos'}. Deleting the label keeps them.`,
      }),
    ],
    extraAction: { label: 'Delete label', danger: true, value: { action: 'delete' } },
    onSubmit: () => {
      const clean = input.value.trim();
      return clean ? { action: 'save', name: clean, color: chosen } : null;
    },
  });
}
