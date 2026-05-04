"use client";

import { createContext, useContext } from "react";
import type { WhitelabelBrand } from "@/types/database";

const BrandContext = createContext<WhitelabelBrand | null>(null);

export function BrandProvider({
  brand,
  children,
}: {
  brand: WhitelabelBrand | null;
  children: React.ReactNode;
}) {
  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>;
}

export function useBrand(): WhitelabelBrand | null {
  return useContext(BrandContext);
}
