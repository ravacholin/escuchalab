import React from 'react';

/**
 * Red de seguridad de render.
 *
 * La app no tenía ninguna: cualquier excepción lanzada durante el render
 * (por ejemplo un campo del plan que el modelo devuelve con una forma
 * inesperada) desmontaba todo el árbol de React y dejaba **la pantalla en
 * negro**, sin mensaje ni forma de recuperarse —justo el síntoma reportado—.
 *
 * Este límite atrapa ese error, muestra qué pasó y ofrece recargar. Recargar
 * también olvida la caché de lecciones (IndexedDB): si lo que reventó fue una
 * lección guardada con una forma antigua, volver a entrar la re-serviría y
 * volvería a romperse.
 */
interface Props {
  children: React.ReactNode;
}
interface State {
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  // El proyecto no instala `@types/react`, así que la clase base llega sin
  // tipos: se declaran a mano los miembros que se usan para que el chequeo de
  // tipos los reconozca.
  props!: Props;
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown): void {
    console.error('[ErrorBoundary] render crash:', error, info);
  }

  private handleReload = (): void => {
    // Olvida cualquier lección cacheada antes de recargar: si el fallo vino de
    // una entrada incompatible, recargar sin esto reproduciría el error.
    try {
      indexedDB.deleteDatabase('escuchalab');
    } catch {
      /* sin IndexedDB: recargar igual */
    }
    window.location.reload();
  };

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-[100dvh] w-full bg-ink flex items-center justify-center p-6 text-fg">
        <div className="w-full max-w-lg rounded-2xl border border-line bg-panel p-8 sm:p-10">
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-faint">
            Error de la aplicación
          </span>
          <h2 className="font-display text-3xl font-semibold text-fg mt-3 mb-4">
            Algo se rompió al mostrar la lección
          </h2>
          <p className="text-sm text-muted leading-relaxed mb-6 border-l-2 border-line pl-4 font-mono break-words">
            {error.message || String(error)}
          </p>
          <button
            onClick={this.handleReload}
            className="w-full px-6 py-3.5 rounded-xl bg-accent text-ink font-display font-semibold text-sm hover:brightness-105 transition-all"
          >
            Recargar y empezar de nuevo
          </button>
        </div>
      </div>
    );
  }
}
