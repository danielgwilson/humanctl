import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { CatalogApp } from "@humanctl/ui/catalog/catalog-app"
import "@humanctl/ui/styles/app.css"

const requestedTheme = new URLSearchParams(window.location.search).get("theme")
document.documentElement.classList.toggle("light", requestedTheme === "light")

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CatalogApp />
  </StrictMode>,
)
