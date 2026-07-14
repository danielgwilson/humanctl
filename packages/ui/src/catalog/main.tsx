import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { FoundationCatalog } from "@humanctl/ui/catalog/foundation-catalog"
import "@humanctl/ui/styles/globals.css"

const requestedTheme = new URLSearchParams(window.location.search).get("theme")
document.documentElement.classList.toggle("light", requestedTheme === "light")

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <FoundationCatalog />
  </StrictMode>,
)
