export interface Saude {
  status: "ok" | "degradado";
  versao: string;
  componentes: Record<string, string>;
}

export async function buscarSaude(fetcher: typeof fetch = fetch): Promise<Saude> {
  const resposta = await fetcher("/api/health");
  if (!resposta.ok && resposta.status !== 503) {
    throw new Error(`Falha ao consultar a API (HTTP ${resposta.status})`);
  }
  return (await resposta.json()) as Saude;
}
