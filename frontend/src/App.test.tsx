import { render, screen } from "@testing-library/react";
import App from "./App";

describe("App", () => {
  it("mostra a situação operacional da plataforma", async () => {
    const carregar = () =>
      Promise.resolve({ status: "ok" as const, versao: "0.1.0", componentes: { postgres: "ok", redis: "ok" } });
    render(<App carregar={carregar} />);
    expect(screen.getByRole("heading", { name: "Portal de Gestão Multinuvem" })).toBeInTheDocument();
    expect(await screen.findByText("Operacional")).toBeInTheDocument();
    expect(screen.getByText("Banco de dados: operacional")).toBeInTheDocument();
  });

  it("informa quando a API está indisponível", async () => {
    render(<App carregar={() => Promise.reject(new Error("sem conexão"))} />);
    expect(await screen.findByText("API indisponível: sem conexão")).toBeInTheDocument();
  });
});
