# fnv-rea

Engenharia reversa de **como o Fallout: New Vegas guarda e restaura a posição dos objetos**
quando você sai de uma célula e volta (e quando salva/carrega o jogo), feita com
[REA](https://github.com/morluto/rea) + Ghidra, seguida de uma reimplementação própria.

| Arquivo | O que é |
|---|---|
| [`SPEC.md`](SPEC.md) | Especificação do comportamento. Cada regra é marcada como observada no executável, inferida ou escolha de projeto, com o ID de evidência do REA. |
| [`my-version/`](my-version/) | Implementação própria (JavaScript, Node 22.19+, sem dependências) feita a partir do SPEC, com 31 testes. |
| [`REA-TASK.md`](REA-TASK.md) | Diário da investigação: funções, endereços e evidências. |

## Rodar

```bash
cd my-version
npm test
npm run demo
```

## Aviso

Análise estática do `FalloutNV.exe` (GOG). Nenhum código do jogo está neste repositório: o SPEC
descreve o comportamento e a implementação foi escrita do zero. Fallout: New Vegas é marca da
Bethesda Softworks; este projeto não é afiliado a ela.
