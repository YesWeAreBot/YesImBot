import type { BasePresenter, PresenterRegistry } from "./presenter.js";
import type { AthenaEventKind } from "./types.js";

export interface PresenterCatalog {
  registerBase<K extends AthenaEventKind>(kind: K, presenter: BasePresenter<K>): () => void;
  has(kind: AthenaEventKind): boolean;
  applyTo(registry: PresenterRegistry): void;
}

export function createPresenterCatalog(): PresenterCatalog {
  const presenters = new Map<AthenaEventKind, BasePresenter>();

  return {
    registerBase(kind, presenter) {
      if (presenters.has(kind)) {
        throw new Error(`Base presenter for "${String(kind)}" is already registered`);
      }

      presenters.set(kind, presenter as BasePresenter);

      return () => {
        if (presenters.get(kind) === presenter) {
          presenters.delete(kind);
        }
      };
    },

    has(kind) {
      return presenters.has(kind);
    },

    applyTo(registry) {
      for (const [kind, presenter] of presenters) {
        registry.registerBase(kind, presenter);
      }
    },
  };
}
