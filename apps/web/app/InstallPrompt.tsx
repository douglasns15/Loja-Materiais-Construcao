'use client';

import { useEffect, useState } from 'react';

// Tipo do evento não-padrão do Chromium (não está no lib.dom padrão).
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

// Botão flutuante "Instalar app" (Fase 3.A). Aparece só quando o navegador sinaliza
// que o PWA é instalável (`beforeinstallprompt`, Android/desktop Chromium) e some
// depois de instalado ou dispensado. No iOS/Safari esse evento não existe (a
// instalação é manual via "Compartilhar → Adicionar à Tela de Início"), então o
// botão simplesmente não aparece — sem quebrar nada.
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Já instalado (rodando em janela standalone) → não oferece instalar.
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      // iOS marca isto quando adicionado à tela inicial.
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) return;

    const onPrompt = (e: Event) => {
      e.preventDefault(); // impede o mini-infobar padrão; controlamos o momento.
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setDeferred(null);

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!deferred) return null;

  const install = async () => {
    await deferred.prompt();
    await deferred.userChoice;
    // Consumido: o evento não pode ser reutilizado.
    setDeferred(null);
  };

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <button
        type="button"
        onClick={install}
        className="flex items-center gap-2 rounded-full bg-gray-900 px-4 py-2 text-sm font-semibold text-white shadow-lg hover:bg-gray-800"
      >
        <span className="text-green-500">↓</span> Instalar app
      </button>
    </div>
  );
}
