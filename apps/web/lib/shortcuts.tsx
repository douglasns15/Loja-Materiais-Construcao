'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { ShortcutsHelp } from '@/components/ShortcutsHelp';

/**
 * Motor de ATALHOS DE TECLADO do NexoLoja (ADR-032). Cobre navegação por sequência `N`+letra, a tecla
 * rápida `F2` (PDV), as ações quentes do PDV (F8/F9, registradas pelas telas), a ajuda `?` e a
 * customização (Configurações → Acessibilidade). Desktop-only e custo-zero (só `apps/web` +
 * `localStorage`).
 *
 * Princípios cross-platform (Mac/Windows/Linux — ADR-032 §1):
 *  - Casamos pelo CÓDIGO FÍSICO da tecla (`event.code`, ex.: `KeyV`/`F2`), nunca pelo caractere
 *    (`event.key`): no Mac `Option+V` insere `√` e o caractere muda com o layout (ABNT/US); o código
 *    físico é estável nos três sistemas e em qualquer layout.
 *  - Navegação por SEQUÊNCIA sem modificador (`N` depois a letra) — zero conflito com navegador/SO e
 *    sem exigir `fn` no Mac. As F-keys ficam para as ações quentes.
 *  - Nada dispara enquanto se digita num campo (protege o leitor de código de barras); F-keys e Esc
 *    são exceção segura.
 */

/** Um comando atalhável: navegação (tem `href`) ou ação contextual (executada por uma tela). */
export type ShortcutCommand = {
  /** Identificador estável (chave das sobrescritas no localStorage). Customizados têm prefixo `custom-`. */
  id: string;
  /** Rótulo amigável para a ajuda e a tela de Acessibilidade. */
  label: string;
  /** Grupo para agrupar na ajuda/configuração. */
  group: 'Navegação' | 'PDV' | 'Geral';
  /**
   * Combinação PADRÃO, no formato normalizado por `event.code`:
   *  - tecla única: `"F2"`, `"Shift+Slash"`;
   *  - sequência (aperta um, depois o outro): `"KeyN,KeyV"`.
   */
  defaultBinding: string;
  /** Navegação: rota de destino. Ausente ⇒ é ação contextual (registrada por uma tela). */
  href?: string;
  /** `true` nos comandos criados pelo usuário (Configurações → Acessibilidade). */
  custom?: boolean;
};

/**
 * Catálogo dos atalhos padrão (ADR-032 §2). Navegação por `N`+letra (letras desempatadas para os nomes
 * que colidem na inicial em PT), F2 = abrir PDV, F8/F9 = ações do PDV, `?` = ajuda.
 */
export const SHORTCUT_CATALOG: ShortcutCommand[] = [
  { id: 'open-pdv', label: 'Abrir PDV (Nova Venda)', group: 'Navegação', defaultBinding: 'F2', href: '/venda' },
  { id: 'nav-venda', label: 'Nova Venda (PDV)', group: 'Navegação', defaultBinding: 'KeyN,KeyV', href: '/venda' },
  { id: 'nav-vendas', label: 'Histórico de Vendas', group: 'Navegação', defaultBinding: 'KeyN,KeyH', href: '/vendas' },
  { id: 'nav-caixa', label: 'Caixa', group: 'Navegação', defaultBinding: 'KeyN,KeyC', href: '/caixa' },
  { id: 'nav-contas', label: 'Contas a Receber', group: 'Navegação', defaultBinding: 'KeyN,KeyR', href: '/contas-a-receber' },
  { id: 'nav-estoque', label: 'Estoque', group: 'Navegação', defaultBinding: 'KeyN,KeyE', href: '/estoque' },
  { id: 'nav-produtos', label: 'Produtos', group: 'Navegação', defaultBinding: 'KeyN,KeyP', href: '/products' },
  { id: 'nav-orcamentos', label: 'Orçamentos', group: 'Navegação', defaultBinding: 'KeyN,KeyO', href: '/orcamentos' },
  { id: 'nav-entregas', label: 'Entregas', group: 'Navegação', defaultBinding: 'KeyN,KeyG', href: '/entregas' },
  { id: 'nav-clientes', label: 'Clientes', group: 'Navegação', defaultBinding: 'KeyN,KeyL', href: '/customers' },
  { id: 'nav-fornecedores', label: 'Fornecedores', group: 'Navegação', defaultBinding: 'KeyN,KeyF', href: '/fornecedores' },
  { id: 'nav-categorias', label: 'Categorias', group: 'Navegação', defaultBinding: 'KeyN,KeyT', href: '/categorias' },
  { id: 'nav-relatorios', label: 'Relatórios', group: 'Navegação', defaultBinding: 'KeyN,KeyD', href: '/relatorios' },
  { id: 'nav-configuracoes', label: 'Configurações', group: 'Navegação', defaultBinding: 'KeyN,KeyS', href: '/configuracoes' },
  // Ações do PDV — registradas pela tela de Nova Venda; só disparam quando ela está montada.
  { id: 'pdv-finalizar', label: 'Finalizar venda (revisão)', group: 'PDV', defaultBinding: 'F8' },
  { id: 'pdv-focar-busca', label: 'Focar busca de produto', group: 'PDV', defaultBinding: 'F9' },
  // Geral.
  { id: 'show-help', label: 'Mostrar os atalhos', group: 'Geral', defaultBinding: 'Shift+Slash' },
];

/** Telas de navegação oferecidas ao criar um atalho customizado (Configurações → Acessibilidade). */
export const NAV_TARGETS: { href: string; label: string }[] = SHORTCUT_CATALOG.filter(
  (c) => c.href && c.id !== 'open-pdv',
).map((c) => ({ href: c.href!, label: c.label }));

/** Sobrescritas do usuário (por dispositivo) e comandos customizados, gravados no navegador. */
const OVERRIDES_KEY = 'nexoloja:shortcuts';
const CUSTOM_KEY = 'nexoloja:shortcuts-custom';
/** Janela para completar a sequência (`N` … letra) antes de desarmar. */
const SEQUENCE_TIMEOUT_MS = 1200;

function loadOverrides(): Record<string, string> {
  try {
    const raw = localStorage.getItem(OVERRIDES_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function loadCustoms(): ShortcutCommand[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    const parsed = raw ? (JSON.parse(raw) as ShortcutCommand[]) : [];
    return Array.isArray(parsed) ? parsed.filter((c) => c && c.id && c.defaultBinding) : [];
  } catch {
    return [];
  }
}

/** O `event.code` já digitável vira rótulo curto: `KeyN`→`N`, `Digit1`→`1`, `Slash`→`/`, `F2`→`F2`. */
export function codeToLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const SPECIAL: Record<string, string> = {
    Slash: '/',
    Comma: ',',
    Period: '.',
    Space: 'Espaço',
    Enter: 'Enter',
    Escape: 'Esc',
    Minus: '-',
    Equal: '=',
    Backslash: '\\',
    Shift: 'Shift',
    Ctrl: 'Ctrl',
    Alt: 'Alt',
    Meta: '⌘/Win',
  };
  return SPECIAL[code] ?? code;
}

/** Transforma um binding normalizado em texto amigável: `"KeyN,KeyH"`→"N depois H"; `"F2"`→"F2". */
export function humanizeBinding(binding: string): string {
  if (!binding) return '—';
  // A ajuda é disparada pelo CARACTERE `?` (independe do layout — ver o handler); mostra como "?".
  if (binding === 'Shift+Slash') return '?';
  return binding
    .split(',')
    .map((step) => step.split('+').map(codeToLabel).join(' + '))
    .join(' depois ');
}

/** Token normalizado de um evento: prefixo de modificadores + `event.code` (ex.: `Shift+Slash`). */
export function eventToToken(e: KeyboardEvent): string {
  return (
    (e.ctrlKey ? 'Ctrl+' : '') +
    (e.altKey ? 'Alt+' : '') +
    (e.shiftKey ? 'Shift+' : '') +
    (e.metaKey ? 'Meta+' : '') +
    e.code
  );
}

/** `true` se a tecla é só um modificador (ignora-se ao capturar uma combinação). */
export function isModifierKey(code: string): boolean {
  return /^(Shift|Control|Alt|Meta)(Left|Right)$/.test(code);
}

type SequenceMap = Map<string, ShortcutCommand>;

type ShortcutsContextValue = {
  /** Registra uma ação contextual (ex.: PDV "finalizar"): retorna o "desregistrar". */
  registerAction: (id: string, handler: () => void) => () => void;
  /** Comandos padrão (fixos) e customizados (do usuário). */
  catalog: ShortcutCommand[];
  customs: ShortcutCommand[];
  /** Binding em vigor (padrão mesclado com a sobrescrita; para customizados, o próprio binding). */
  effectiveBinding: (id: string) => string;
  /** Grava/limpa a combinação de um comando (padrão vira sobrescrita; customizado é editado direto). */
  setBinding: (id: string, binding: string) => void;
  resetBinding: (id: string) => void;
  resetAll: () => void;
  /** Cria/remove um atalho customizado apontando para uma tela. */
  addCustom: (label: string, href: string, binding: string) => void;
  removeCustom: (id: string) => void;
  /** Comando que JÁ usa `binding` (exceto `exceptId`) — para avisar conflito ao capturar. */
  conflict: (binding: string, exceptId: string) => ShortcutCommand | null;
  openHelp: () => void;
};

const ShortcutsContext = createContext<ShortcutsContextValue | null>(null);

export function useShortcuts(): ShortcutsContextValue {
  const ctx = useContext(ShortcutsContext);
  if (!ctx) throw new Error('useShortcuts precisa estar dentro de <ShortcutsProvider>.');
  return ctx;
}

/** Alvo de digitação: não disparar atalhos de letra/sequência enquanto se escreve nele. */
function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/**
 * Provider único no shell (ADR-032). Instala UM listener global de teclado no desktop, resolve
 * navegação/ajuda por conta própria e guarda o registro de ações contextuais das telas. Mostra o
 * indicador "N …" enquanto a sequência está armada e a ajuda `?`.
 */
export function ShortcutsProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [customs, setCustoms] = useState<ShortcutCommand[]>([]);
  const [armedLabel, setArmedLabel] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  const actionsRef = useRef<Map<string, () => void>>(new Map());
  const registerAction = useCallback((id: string, handler: () => void) => {
    actionsRef.current.set(id, handler);
    return () => {
      if (actionsRef.current.get(id) === handler) actionsRef.current.delete(id);
    };
  }, []);

  // Preferências só existem no cliente — lê após montar (evita divergência de hidratação) e
  // acompanha mudanças de outra aba.
  useEffect(() => {
    setOverrides(loadOverrides());
    setCustoms(loadCustoms());
    const onStorage = (e: StorageEvent) => {
      if (e.key === OVERRIDES_KEY) setOverrides(loadOverrides());
      if (e.key === CUSTOM_KEY) setCustoms(loadCustoms());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const persistOverrides = useCallback((next: Record<string, string>) => {
    setOverrides(next);
    try {
      localStorage.setItem(OVERRIDES_KEY, JSON.stringify(next));
    } catch {
      /* storage indisponível: vale só nesta sessão */
    }
  }, []);
  const persistCustoms = useCallback((next: ShortcutCommand[]) => {
    setCustoms(next);
    try {
      localStorage.setItem(CUSTOM_KEY, JSON.stringify(next));
    } catch {
      /* idem */
    }
  }, []);

  const effectiveBinding = useCallback(
    (id: string) => {
      const custom = customs.find((c) => c.id === id);
      if (custom) return custom.defaultBinding;
      const cmd = SHORTCUT_CATALOG.find((c) => c.id === id);
      return overrides[id] ?? cmd?.defaultBinding ?? '';
    },
    [overrides, customs],
  );

  // Lista única (padrão + customizados) já com o binding EFETIVO — base da execução, ajuda e config.
  const all = useMemo<ShortcutCommand[]>(() => {
    const base = SHORTCUT_CATALOG.map((c) => ({ ...c, defaultBinding: overrides[c.id] ?? c.defaultBinding }));
    return [...base, ...customs];
  }, [overrides, customs]);

  const setBinding = useCallback(
    (id: string, binding: string) => {
      if (id.startsWith('custom-')) {
        persistCustoms(customs.map((c) => (c.id === id ? { ...c, defaultBinding: binding } : c)));
      } else {
        persistOverrides({ ...overrides, [id]: binding });
      }
    },
    [customs, overrides, persistCustoms, persistOverrides],
  );
  const resetBinding = useCallback(
    (id: string) => {
      if (id.startsWith('custom-')) return; // customizado não tem "padrão"; use remover
      const next = { ...overrides };
      delete next[id];
      persistOverrides(next);
    },
    [overrides, persistOverrides],
  );
  const resetAll = useCallback(() => persistOverrides({}), [persistOverrides]);

  const addCustom = useCallback(
    (label: string, href: string, binding: string) => {
      const id = `custom-${Date.now().toString(36)}`;
      persistCustoms([...customs, { id, label, group: 'Navegação', defaultBinding: binding, href, custom: true }]);
    },
    [customs, persistCustoms],
  );
  const removeCustom = useCallback(
    (id: string) => persistCustoms(customs.filter((c) => c.id !== id)),
    [customs, persistCustoms],
  );

  const conflict = useCallback(
    (binding: string, exceptId: string) =>
      all.find((c) => c.id !== exceptId && c.defaultBinding === binding) ?? null,
    [all],
  );

  // Índices de casamento (teclas únicas e sequências por tecla-líder), derivados da lista efetiva.
  const { singles, sequences } = useMemo(() => {
    const singles = new Map<string, ShortcutCommand>();
    const sequences = new Map<string, SequenceMap>();
    for (const cmd of all) {
      // A ajuda é tratada pelo caractere `?` no handler (layout-independente), fora deste índice físico.
      if (cmd.id === 'show-help') continue;
      const binding = cmd.defaultBinding;
      if (!binding) continue;
      const steps = binding.split(',');
      if (steps.length === 2 && steps[0] && steps[1]) {
        const lead = steps[0];
        const second = steps[1];
        const map = sequences.get(lead) ?? new Map<string, ShortcutCommand>();
        map.set(second, cmd);
        sequences.set(lead, map);
      } else {
        singles.set(binding, cmd);
      }
    }
    return { singles, sequences };
  }, [all]);

  /** Executa um comando: navega, abre a ajuda, ou dispara a ação registrada pela tela. */
  const run = useCallback(
    (cmd: ShortcutCommand) => {
      if (cmd.id === 'show-help') {
        setHelpOpen(true);
        return;
      }
      if (cmd.href) {
        router.push(cmd.href);
        return;
      }
      actionsRef.current.get(cmd.id)?.();
    },
    [router],
  );

  useEffect(() => {
    // Desktop-only (ADR-032 §5): sem teclado físico o recurso não vale.
    if (typeof window === 'undefined' || !window.matchMedia('(min-width: 768px)').matches) return;

    let pendingLead: string | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const disarm = () => {
      pendingLead = null;
      if (timer) clearTimeout(timer);
      timer = null;
      setArmedLabel(null);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;

      const isFKey = /^F\d{1,2}$/.test(e.code);
      const typing = isTypingTarget(e.target);

      // Ajuda `?`: pelo CARACTERE (não pelo código físico) — assim vale em qualquer layout (ABNT2,
      // US, etc.), onde o `?` fica em posições diferentes. Fora de campo e sem Ctrl/Alt/⌘.
      if (!typing && !e.ctrlKey && !e.altKey && !e.metaKey && e.key === '?') {
        e.preventDefault();
        disarm();
        setHelpOpen(true);
        return;
      }

      // 1) Sequência armada: o próximo passo tenta completar (só sem modificador, fora de campo).
      if (pendingLead && !typing && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const cmd = sequences.get(pendingLead)?.get(e.code);
        if (cmd) {
          e.preventDefault();
          disarm();
          run(cmd);
          return;
        }
        disarm(); // passo inválido: desarma e deixa o evento seguir
      }

      // 2) Tecla única (F-keys valem inclusive dentro de campos; as demais, não).
      const single = singles.get(eventToToken(e));
      if (single && (isFKey || !typing)) {
        e.preventDefault();
        disarm();
        run(single);
        return;
      }

      // 3) Tecla-líder de alguma sequência: arma (fora de campo, sem modificador).
      if (!typing && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && sequences.has(e.code)) {
        e.preventDefault();
        pendingLead = e.code;
        setArmedLabel(codeToLabel(e.code));
        if (timer) clearTimeout(timer);
        timer = setTimeout(disarm, SEQUENCE_TIMEOUT_MS);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (timer) clearTimeout(timer);
    };
  }, [singles, sequences, run]);

  const value = useMemo<ShortcutsContextValue>(
    () => ({
      registerAction,
      catalog: SHORTCUT_CATALOG.map((c) => ({ ...c, defaultBinding: overrides[c.id] ?? c.defaultBinding })),
      customs,
      effectiveBinding,
      setBinding,
      resetBinding,
      resetAll,
      addCustom,
      removeCustom,
      conflict,
      openHelp: () => setHelpOpen(true),
    }),
    [registerAction, overrides, customs, effectiveBinding, setBinding, resetBinding, resetAll, addCustom, removeCustom, conflict],
  );

  return (
    <ShortcutsContext.Provider value={value}>
      {children}
      {/* Indicador "N …" enquanto a sequência está armada — desktop-only, canto inferior esquerdo. */}
      {armedLabel && (
        <div
          className="fixed bottom-4 left-4 z-[90] hidden items-center gap-2 rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white shadow-lg md:inline-flex"
          role="status"
          aria-live="polite"
        >
          <kbd className="rounded bg-white/20 px-1.5 py-0.5 text-xs font-bold">{armedLabel}</kbd>
          <span className="text-gray-300">…</span>
          <span className="text-xs text-gray-400">aguardando a próxima tecla</span>
        </div>
      )}
      {helpOpen && <ShortcutsHelp onClose={() => setHelpOpen(false)} />}
    </ShortcutsContext.Provider>
  );
}
