import { createContext, useContext, useEffect, useState } from "react";
import { NavLink, Route, Routes, Link } from "react-router-dom";
import { api } from "./api";
import type { AppConfig } from "./types";
import Home from "./pages/Home";
import Desk from "./pages/Desk";
import Studio from "./pages/Studio";
import Shop from "./pages/Shop";
import Product from "./pages/Product";
import OrderPage from "./pages/OrderPage";
import Orders from "./pages/Orders";

const ConfigContext = createContext<AppConfig | null>(null);
export const useConfig = () => useContext(ConfigContext);

function ModeStrip({ config }: { config: AppConfig | null }) {
  if (!config) return <div className="mode-strip" aria-hidden />;
  const aiLive = config.aiMode === "live";
  const ppLive = config.paymentsMode === "sandbox";
  return (
    <div className="mode-strip" role="status">
      <span className={aiLive ? "mode live" : "mode sim"}>
        <i /> AI · {aiLive ? `Gemini live (${config.aiModel})` : "SIMULATION: fixture listings, not AI output"}
      </span>
      <span className={ppLive ? "mode live" : "mode sim"}>
        <i /> Payments · {ppLive ? "PayPal Sandbox" : "SIMULATION: SIM- ids, no PayPal, no money"}
      </span>
    </div>
  );
}

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  useEffect(() => {
    api<AppConfig>("/config").then(setConfig).catch(() => setConfig(null));
  }, []);

  return (
    <ConfigContext.Provider value={config}>
      <header className="masthead">
        <div className="masthead-inner">
          <Link to="/" className="wordmark">
            Film<span>-to-</span>Export
          </Link>
          <nav>
            <NavLink to="/" end>
              Broker desk
            </NavLink>
            <NavLink to="/orders">Orders</NavLink>
            <NavLink to="/shop" className="nav-minor">
              Shop
            </NavLink>
            <NavLink to="/about" className="nav-minor">
              About
            </NavLink>
          </nav>
        </div>
        <ModeStrip config={config} />
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Desk />} />
          <Route path="/about" element={<Home />} />
          <Route path="/studio" element={<Studio />} />
          <Route path="/shop" element={<Shop />} />
          <Route path="/shop/:id" element={<Product />} />
          <Route path="/pay/:id" element={<Product variant="pay" />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/orders/:id" element={<OrderPage />} />
          <Route path="*" element={<div className="page narrow"><h1 className="display">Not found</h1></div>} />
        </Routes>
      </main>
      <footer className="colophon">
        <div>
          <strong>Film-to-Export</strong>: a PayPal AI Hackathon entry. Sandbox only; no real money moves. HS codes are AI
          suggestions the seller confirms, not customs advice.
        </div>
        <div className="mono">MIT licensed</div>
      </footer>
    </ConfigContext.Provider>
  );
}
