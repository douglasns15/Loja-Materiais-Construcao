/**
 * Aviso padronizado de "Loja desativada" (ADR-009) — a mesma caixa vermelha usada quando o
 * Super Usuário inativa a loja. Mostrado no lugar da ação bloqueada (nova venda, abrir caixa,
 * entrada de estoque), guiado por `me.tenantActive` — aparece já ao abrir a tela, sem depender
 * de um erro 403 da API. `message` descreve a operação específica bloqueada.
 */
export function StoreDisabledNotice({ message }: { message?: string }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
      <p className="mb-1 font-semibold text-red-800">Loja desativada</p>
      <p className="text-sm text-red-700">
        {message ?? 'Esta operação está bloqueada. Fale com o suporte para reativar a loja.'}
      </p>
    </div>
  );
}
