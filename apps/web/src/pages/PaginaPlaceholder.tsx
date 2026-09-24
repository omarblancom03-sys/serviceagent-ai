interface Props {
  titulo: string;
}

/** Página temporal: cada historia reemplaza la suya con la pantalla real. */
export function PaginaPlaceholder({ titulo }: Props) {
  return <h1 className="text-3xl font-bold text-orange-800">{titulo}</h1>;
}
