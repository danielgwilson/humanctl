import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { CatalogApp } from "@humanctl/ui/catalog/catalog-app"
import "@humanctl/ui/styles/app.css"
// catalog.css carries `@source "../catalog"`, the scan that generates the
// Tailwind utilities used only by the catalog viewer (padding, min-height,
// spacing). Without it, catalog-only classes silently do not emit and the
// layout loses its spacing. globals.css only scans components/blocks/product.
import "@humanctl/ui/styles/catalog.css"

const requestedTheme = new URLSearchParams(window.location.search).get("theme")
document.documentElement.classList.toggle("light", requestedTheme === "light")

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CatalogApp />
  </StrictMode>,
)
