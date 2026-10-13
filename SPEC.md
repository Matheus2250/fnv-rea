# SPEC — Persistência da posição de objetos entre células

Especificação comportamental derivada da análise estática de `FalloutNV.exe`
(GOG, SHA-256 `89e7020487e80f20ddc92ea641c4433b2c6839a82f45a076e414d167d11dd0fe`)
com REA + Ghidra 12.1.4. Nenhum código do jogo foi copiado: este documento descreve
**o que** acontece, não **como** o código original está escrito.

Legenda de cada regra:

- **[OBS]** observado diretamente no programa (pseudocódigo/strings), com Evidence ID.
- **[INF]** inferido a partir da evidência, não provado.
- **[PROJ]** escolha de projeto para a nossa versão, onde o original é desconhecido.

---

## 1. Conceitos

| Termo | Significado |
|---|---|
| Referência (ref) | Uma instância de objeto colocada no mundo (item, móvel, ator). Tem ID, posição, rotação e célula. |
| Célula | Um "pedaço" do mundo. **Interior** (uma sala) ou **exterior** (um quadrado do mundo aberto). |
| Worldspace | O mundo aberto que contém as células exteriores. |
| Mapa de mudanças | Tabela `ID → registro { flags, buffer }` que lembra o que mudou em cada ref. |
| Flags de mudança | Bits que dizem *o que* mudou. |

## 2. Flags de mudança de referências

[OBS] `FUN_0083fef0`, `ev_03e1b3b5…`

| Nome | Valor | Significado |
|---|---|---|
| `FORM_FLAGS` | `0x00000001` | flags genéricas da forma |
| `MOVE` | `0x00000002` | posição/rotação mudou |
| `HAVOK_MOVE` | `0x00000004` | a física moveu o objeto |
| `CELL_CHANGED` | `0x00000008` | o objeto foi para outra célula |
| `SCALE` | `0x00000010` | escala mudou |
| `INVENTORY` | `0x00000020` | inventário mudou |
| `ANIMATION` | `0x10000000` | estado de animação guardado |

Máscara de posição: `POSITION_MASK = MOVE | HAVOK_MOVE = 0x6`.

## 3. Registro no mapa de mudanças

[OBS] `ev_bbc5a28e…`, `ev_04752d89…`

- Cada ref com mudanças tem um registro `{ flags: u32, buffer: bytes | null }`.
- **Ligar** flags: `flags |= f` (cria o registro se não existir).
- **Substituir** flags: `flags = f`.
- **Testar** flag: `(flags & f) != 0`.
- **Remover** registro.

## 4. Marcar como movido

- **R4.1 [OBS]** Mudar a posição de uma ref liga `MOVE`. (`SetPos`, `FUN_00575830`, `ev_c108a782…`)
- **R4.2 [OBS]** Mudar a rotação de uma ref liga `MOVE`. (`SetAngle`, `FUN_00575700`, `ev_4c33080f…`)
- **R4.3 [OBS]** Se a posição pedida tiver `|x| > 4 096 000`, `|y| > 4 096 000`, ou componente igual a ±`FLT_MAX`,
  a posição é substituída por uma posição segura e `z` recebe `+10`. (`ev_c108a782…`)
  - [PROJ] "posição segura" = posição original do editor da ref (a função exata `vtbl+0x138` não foi analisada).
- **R4.4 [INF]** Ligar flags só acontece se o sistema de save permitir (`FUN_0084a620`); as condições exatas
  são desconhecidas. [PROJ] Nossa versão sempre permite.
- **R4.5 [DESCONHECIDO]** Quem liga `HAVOK_MOVE`. [PROJ] Nossa versão expõe `markHavokMoved(ref)` explicitamente.

## 5. Formato do registro de posição (28 bytes)

[OBS] Escrita `FUN_0085a520` (`ev_9ad2b0e3…`) e leitura `FUN_0085ac30` (`ev_34926445…`).

| Offset | Tamanho | Campo |
|---|---|---|
| 0 | 4 | ID do local: **worldspace** se a ref está numa célula exterior, senão a **célula** interior |
| 4 | 12 | posição `x, y, z` (3 × float32) |
| 16 | 12 | rotação `x, y, z` (3 × float32) |

- **R5.1 [OBS]** O registro só é escrito/lido se `(flags & POSITION_MASK) != 0`.
- **R5.2 [PROJ]** Little-endian (x86). Endianness do arquivo original não foi verificada byte a byte.

## 6. Restaurar a posição (ao carregar a ref)

[OBS] `FUN_0085ac30` (`ev_34926445…`), validação `FUN_008624e0` (`ev_9c61861f…`)

1. Se a forma não é uma ref, ou `(flags & POSITION_MASK) == 0` → **não faz nada**.
2. Lê os 28 bytes; aplica rotação e posição.
3. Validação:
   - **R6.1 [OBS]** posição corrompida → volta à posição do editor ("Corrupt location … fixing it").
   - **R6.2 [OBS]** rotação corrompida → `(0, 0, 0)` ("Corrupt angle … setting to (0, 0, 0)").
   - [PROJ] "corrompido" = algum componente não-finito (NaN/±∞) ou fora de ±4 096 000 (o critério exato
     de `FUN_00862430` é desconhecido).
4. Escolha da célula:
   - **R6.3 [OBS]** ID é uma célula interior → a ref vai para essa célula.
   - **R6.4 [OBS]** ID é um worldspace → célula exterior em `(cx, cy) = (int(x) >> 12, int(y) >> 12)`,
     ou seja, células de **4096 unidades**.
   - [PROJ] `int()` = truncamento em direção a zero; `>> 12` = shift aritmético (floor para negativos).

## 7. Classificação de referências no mapa

[OBS] `FUN_0084e730` (`ev_c3e1fdf2…`)

| Código | Condição (em ordem) |
|---|---|
| 5 `CREATED` | ref criada durante o jogo |
| 6 `CELL_CHANGED` | flag `CELL_CHANGED` ligada |
| 4 `MOVED_IN_PLACE` | `flags & POSITION_MASK` |
| 0 `NONE` | nenhuma das anteriores |

## 8. Ao montar o 3D de uma célula (entrar/voltar)

[OBS] `FUN_00545cf0` → `FUN_00849b10` → `FUN_00852d20` → `FUN_00852e40` (`ev_4290cba0…`, `ev_ab65df91…`, `ev_9c61861f…`)

- **R8.1 [OBS]** Para cada ref registrada para essa célula no "mapa de referências":
  - `CREATED` → recria a ref a partir do buffer guardado.
  - `CELL_CHANGED` → lê o buffer, descobre o local; interior → põe na célula; exterior → põe na célula do
    worldspace calculada por (x, y).
  - Qualquer outro tipo → erro "neither a created reference or a moved reference".
  - Sem buffer → erro "no unloaded buffer for it in the changes map".
- **R8.2 [INF]** Refs movidas *na mesma célula* (tipo 4) não passam por aqui; a posição vem do passo 6
  quando a própria ref é carregada.

## 9. Ao remover o 3D de uma ref (sair da célula)

[OBS] `FUN_005702e0` (`ev_4290cba0…`), `FUN_00422ac0` (`ev_15c0e56c…`)

- **R9.1 [OBS]** Se `HAVOK_MOVE` está ligado: tira um "snapshot" do estado físico e guarda **na própria ref**
  (dado extra). Se já existia um → aviso "SetSavedHavokData() is being called when there is already saved havok data"
  e substitui.
- **R9.2 [OBS]** Se `ANIMATION` está ligado: guarda o estado de animação; se não conseguir, **desliga** `ANIMATION`.
- **R9.3 [INF]** A ref continua na memória com posição/rotação; nenhum buffer é gerado neste momento
  (busca estática limitada: o gravador de buffer só é chamado pelo carregador de save).
- **R9.4 [PROJ]** Conteúdo do snapshot físico = `{ linearVelocity, angularVelocity }` (formato real desconhecido).

## 10. Ao recriar o 3D da ref

[INF] `FUN_00865390` / `FUN_00422a40` → `FUN_00864b00`

- **R10.1** Se a ref tem snapshot físico guardado → aplica e **apaga** o snapshot.

## 11. Salvar o jogo

[OBS] `FUN_00856ca0` (`ev_5c2ec802…`)

Para cada registro no mapa de mudanças:

- **R11.1** Ref **na memória** → serializa agora: cabeçalho + registro de posição (passo 5, se aplicável) + resto.
- **R11.2** Ref **não na memória** mas com buffer → copia os bytes do buffer **sem alterar**.

## 12. Carregar o jogo

[OBS] `FUN_00847df0` (`ev_dfb167dc…`)

Para cada registro salvo:

- **R12.1** Ref **existe na memória** → aplica as mudanças imediatamente (passo 6).
- **R12.2** Ref **não existe na memória** → guarda os bytes como buffer no mapa de mudanças (flags + buffer);
  aplica quando a célula da ref for carregada (passo 8 / passo 6).
- **R12.3 [OBS]** Tipo salvo diferente do tipo atual → o registro é ignorado
  ("was saved with form type %s, but currently has form type %s. Its loading will be skipped").

## 13. Casos de borda

| Caso | Comportamento |
|---|---|
| Ref sem flags de posição | Nenhum registro de posição é gravado/lido (R5.1). |
| Só a rotação mudou | `MOVE` ligado (R4.2) → posição *e* rotação gravadas. |
| Coordenada absurda em `setPos` | Posição segura + `z+10` (R4.3). |
| Posição corrompida no save | Volta à posição do editor (R6.1). |
| Rotação corrompida no save | `(0,0,0)` (R6.2). |
| Ref exterior em `x = -1` | `int(-1) >> 12 = -1` → célula `-1` (R6.4). |
| Buffer ausente para ref no mapa de referências | Erro registrado, ref ignorada (R8.1). |
| Tipo salvo ≠ tipo atual | Registro ignorado (R12.3). |
| Snapshot físico duplicado | Aviso + substitui (R9.1). |

## 14. Desconhecidos (não implementados como fato)

- U1b: quem liga `HAVOK_MOVE`.
- U2b: se existe serialização ao descarregar totalmente uma célula (ex.: reset de células com `CHANGE_CELL_DETACHTIME`).
- U3: formato real do snapshot físico.
- Critério exato de "corrompido" (`FUN_00862430`) e da "posição segura" (`vtbl+0x138`).
