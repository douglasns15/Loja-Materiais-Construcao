# @nexoloja/fiscal — serviço de emissão fiscal (NFC-e)

Worker Cloudflare **separado** da API de negócio, responsável por emitir, consultar e cancelar NFC-e (modelo 65).

> **Estado: primeira fatia.** O domínio, a porta do provedor e um adaptador de simulação estão prontos e testados. **Ainda não há adaptador de provedor real, nem persistência em banco, nem encaixe no fluxo da aplicação** — isso é deliberado (ver "Por onde continuar").

## Por que um serviço separado

1. **Isolamento de segredos** — o certificado digital A1 e as credenciais do provedor são os segredos mais sensíveis do produto; ficam fora do Worker de negócio.
2. **Deploy independente** — emissão fiscal muda por motivo legal, não por motivo de produto.
3. **Menos conflito** — arquivos próprios, sem disputa com o desenvolvimento em paralelo.

## Desenho

```
POST /nfce                              emite (idempotente)
GET  /nfce/:tenantId/:orderId           consulta
POST /nfce/:tenantId/:orderId/cancel    cancela (dentro do prazo)
GET  /health                            sonda pública
```

```
routes/ ──► service.ts ──► providers/  (PORTA: FiscalProvider)
                 │              └── fake.ts        ← simulação determinística
                 │              └── focus.ts       ← a implementar
                 └────────► store/      (PORTA: FiscalDocumentStore)
                                └── memory.ts      ← efêmero, para dev/teste
                                └── prisma.ts      ← a implementar (exige migration)
     domain/  ── regras puras, sem I/O (testadas com Vitest)
```

**Portas e adaptadores** é o que permite construir e testar a emissão inteira antes de contratar um provedor: trocar `fake` por `focus` não muda uma linha do domínio.

### Garantias implementadas

| Garantia | Onde | Por quê |
|---|---|---|
| **Idempotência** por `(tenantId, orderId)` | `service.ts` | Uma venda nunca gera duas notas — a lição do ADR-025 §5.B |
| **Validar antes de transmitir** | `domain/document.ts` | Erro de preenchimento não queima numeração fiscal nem chamada paga |
| **Contingência automática** | `service.ts` | SEFAZ fora do ar não pode travar a venda no balcão |
| **Estados terminais respeitados** | `domain/document.ts` | `DENIED`/`CANCELLED` não voltam; `REJECTED` permite corrigir e retransmitir |
| **Falha fechada na autenticação** | `middleware/auth.ts` | Sem token configurado, recusa tudo |
| **`fake` bloqueado em produção** | `index.ts` | Simulação jamais pode virar nota "emitida" para o lojista |

## Rodar localmente

```bash
npm install                       # na raiz, se ainda não instalou as novas deps
cp apps/fiscal/.dev.vars.example apps/fiscal/.dev.vars
npm run dev --workspace @nexoloja/fiscal
```

Chamada de exemplo (o token vem do `.dev.vars`):

```bash
curl -X POST http://localhost:8787/nfce \
  -H "X-Fiscal-Token: dev-token-trocar-em-producao" \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId":"t1","orderId":"o1","model":"NFCE","number":128,
    "issuer":{"cnpj":"11222333000181","ufCode":35,"series":1},
    "items":[{"code":"CIM-50","description":"Cimento CP-II 50kg",
      "quantityMilli":10000,"unitPriceCents":3990,"discountCents":0,
      "tax":{"cfop":"5102","ncm":"25232910","origin":0,"csosnOrCst":"102","unit":"UN"}}],
    "payments":[{"method":"CASH","amountCents":3990}]
  }'
```

> ⚠️ A porta 8787 é a mesma da API. Rode um de cada vez, ou use `--port` para separar.

### Gatilhos do adaptador de simulação

Coloque a palavra na **descrição de um item** para forçar o caminho:

| Palavra | Desfecho |
|---|---|
| `REJEITAR` | Rejeição (corrigível — permite retransmitir) |
| `DENEGAR` | Denegação (terminal) |
| `FALHAR` | Falha de infra transitória → cai em contingência |
| *(qualquer outra)* | Autorizada |

## Testes

```bash
npm run test --workspace @nexoloja/fiscal
npm run typecheck --workspace @nexoloja/fiscal
```

Cobrem: dígito verificador de CPF/CNPJ, chave de acesso de 44 dígitos (layout, DV, round-trip), totais em centavos com quantidade fracionada, máquina de estados, janela de cancelamento, validação do pedido, adaptador de simulação e as garantias do serviço.

## Convenções

- **Dinheiro em centavos** (inteiro) e **quantidade ×10.000**, espelhando `Decimal(12,4)` do schema. Ponto flutuante geraria diferença de centavo — e a SEFAZ **rejeita** nota cuja soma dos itens não bate com o total.
- **Domínio sem I/O** — funções puras `(entrada) => saída`, conforme o `CLAUDE.md`.
- **Erro de negócio é valor de retorno; erro de infra é exceção** — mesmo princípio do `classifyHttpOutcome` em `packages/core`.

## ⚠️ Limites conhecidos (leia antes de confiar)

- **Não calcula imposto.** CFOP, NCM, CST/CSOSN e origem são **entradas** vindas do cadastro, nunca inferidas. Dependem do regime tributário da loja e da UF, e devem ser definidos **com o contador do cliente**. Um palpite errado gera nota rejeitada ou imposto recolhido a menor.
- **Prazo de cancelamento de 30 min** é o padrão geral, mas **varia por UF** e por norma. Confirmar antes de produção (`CANCEL_WINDOW_MINUTES`).
- **Persistência efêmera.** O `MemoryFiscalStore` some quando o isolate recicla.
- **Sem certificado digital.** O armazenamento cifrado do A1 ainda não foi desenhado.
- **Contingência não retransmite sozinha.** O documento fica marcado; falta a fila de reenvio.

## Por onde continuar

1. **ADR-026** — escolher o provedor, desenhar o armazenamento do certificado A1 e a política de contingência.
2. **Adaptador real** (`providers/focus.ts` ou equivalente), reusando os testes do `fake` como contrato.
3. **Persistência** — `store/prisma.ts` + tabela `fiscal_documents`. **Exige migration e aprovação explícita do Owner** (regra 1 do `CLAUDE.md`).
4. **Fila de retransmissão** da contingência — conversa com o ADR-011/012 (offline-first).
5. **DANFE NFC-e** com QR Code na impressão.
6. **Encaixe na aplicação** — `apps/api` chama este serviço ao confirmar a venda. **Deixado por último de propósito**, para minimizar conflito com o trabalho em paralelo.
