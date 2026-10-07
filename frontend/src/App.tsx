import { useEffect, useState } from "react";
import { buscarSaude, type Saude } from "./api";

const NOMES: Record<string, string> = { postgres: "Banco de dados", redis: "Fila de tarefas" };

export default function App({ carregar = buscarSaude }: { carregar?: () => Promise<Saude> }) {
  const [saude, setSaude] = useState<Saude | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    carregar()
      .then(setSaude)
      .catch((e: unknown) => setErro(e instanceof Error ? e.message : "Erro desconhecido"));
  }, [carregar]);

  return (
    <>
      <header className="cabecalho">
        <h1>Portal de Gestão Multinuvem</h1>
        <p>Comissão de Valores Mobiliários — Pregão Eletrônico nº 90016/2026</p>
      </header>
      <main>
        <section aria-labelledby="titulo-saude">
          <h2 id="titulo-saude">Situação da plataforma</h2>
          <div role="status" aria-live="polite">
            {erro && <p className="erro">API indisponível: {erro}</p>}
            {!erro && !saude && <p>Verificando…</p>}
            {saude && (
              <>
                <p>
                  Situação geral: <strong>{saude.status === "ok" ? "Operacional" : "Degradada"}</strong>{" "}
                  (versão {saude.versao})
                </p>
                <ul>
                  {Object.entries(saude.componentes).map(([nome, estado]) => (
                    <li key={nome}>
                      {NOMES[nome] ?? nome}: {estado === "ok" ? "operacional" : estado}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </section>
      </main>
    </>
  );
}
