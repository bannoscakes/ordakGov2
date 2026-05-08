import { createElement, type ReactNode } from "react";

type Props = {
  variant?: "primary";
  loading?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
};

// App Bridge SaveBar accepts plain <button> children with a `variant="primary"`
// attribute to mark the Save action. That attribute isn't part of
// HTMLButtonElement, so we forward it via a single typed wrapper that calls
// React.createElement with a permissive props object.
export function SaveBarButton({ variant, loading, disabled, onClick, children }: Props) {
  return createElement(
    "button",
    {
      ...(variant ? { variant } : {}),
      ...(loading ? { loading: true } : {}),
      ...(disabled ? { disabled: true } : {}),
      onClick,
      type: "button",
    } as Record<string, unknown>,
    children,
  );
}
