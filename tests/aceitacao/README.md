# Kit de teste — Cloud Broker CVM (PE 90016/2026)

Dados **fictícios** de uma competência (novembro/2026) e o resultado esperado,
calculado de forma independente. Serve como teste de aceitação do motor de
medição, SLA e faturamento.

## Como rodar

    pip install pytest
    BROKER_CMD="python -m broker.cli" pytest -v test_aceitacao.py

## O que cada arquivo exercita

| Arquivo | Regra testada |
| --- | --- |
| contrato.csv | Valores unitários e quantidades totais dos 6 itens (TR 1.1) |
| catalogo.csv | Catálogo por CSP com Fator USN em US$; itens gratuitos (entrada de dados, tráfego na mesma zona) |
| contas.csv | Só contas exclusivas da CVM são faturadas (TR 3.8.4) |
| billing_azure.csv / billing_aws.csv | Q × F × USN por categoria; SKU fora do catálogo vira pendência; conta de terceiro vira pendência; recurso sem tag |
| instancias_gerenciadas.csv | Item 4 proporcional aos dias do mês; data_exclusao é o primeiro dia sem gestão |
| catalogo_ust.csv / ordens_servico.csv | Item 5: UST base × fator (alta 1, média 0,5, baixa 0,25); serviços 19–21 usam ust_definida; só OS concluída no mês e aceita |
| turmas.csv | Item 6: participantes de turmas concluídas no mês |
| chamados.csv / feriados.csv | Prazos e descontos por severidade, horas corridas × úteis (08h–18h, seg–sex, sem feriados) |
| ocorrencias_nms.csv | Pontos de NMS de grande impacto; 1% de glosa a cada 30 pontos; contestação aceita não pontua |
| catalogo_invalido.csv | Fator USN maior que o preço da calculadora deve ser rejeitado (TR 10.43.4) |

## Premissas de cálculo (onde o TR é omisso)

1. USN por categoria = Σ(Q × F) sem arredondar por linha; arredonda-se a soma a 2 casas e então multiplica-se pelo valor da USN, arredondando a 2 casas (meio para cima).
2. Item 4: Σ(dias geridos no mês ÷ dias do mês), 4 casas.
3. Atrasos de chamados contam por hora iniciada (arredonda para cima). O prazo de solução começa ao fim do prazo de início (Anexo TR.IV, item 3.4).
4. Desconto de início: 0,3%/h corrida (sev. 1 e 2), 0,1%/h corrida (sev. 3 e 4), sem teto. Desconto de solução: 1%/h (sev. 1), 0,5%/h (sev. 2), 0,2%/h útil (sev. 3), 0,1%/h útil (sev. 4), teto de 10% por chamado. Solicitações de serviço não geram desconto.
5. Os descontos de suporte incidem sobre o valor do Item 4 do mês.
6. Ordem: subtotal → menos desconto de suporte → glosa de pontos NMS (% sobre o resultado) → total.

Todas as premissas devem ser parâmetros configuráveis no sistema, porque podem mudar após esclarecimento com o pregoeiro.
