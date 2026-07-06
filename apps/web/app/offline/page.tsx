'use client';

// Página mostrada quando uma navegação falha por falta de rede e não há versão
// em cache da página pedida (Fase 3.A). É pré-cacheada pelo service worker, então
// aparece mesmo totalmente offline. Não depende de sessão nem da API.
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-900 text-2xl font-black text-green-500">
        N
      </div>
      <h1 className="text-xl font-bold text-gray-900">Você está offline</h1>
      <p className="text-sm text-gray-600">
        Não foi possível carregar esta página sem conexão. Verifique a internet e tente de novo.
        As telas já abertas continuam disponíveis.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
      >
        Tentar novamente
      </button>
    </main>
  );
}
