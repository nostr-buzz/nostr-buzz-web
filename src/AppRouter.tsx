import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ScrollToTop } from "./components/ScrollToTop";

import { BuzzProvider } from "./components/buzz/BuzzProvider";
import { AppShell } from "./components/chat/AppShell";
import { DMProvider } from "./components/dm/DMProvider";
import ChatPage from "./pages/ChatPage";
import Index from "./pages/Index";
import JoinPage from "./pages/JoinPage";
import { NIP19Page } from "./pages/NIP19Page";
import NotFound from "./pages/NotFound";
import SettingsPage from "./pages/SettingsPage";

export function AppRouter() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      {/* Buzz + DM providers live inside the router so they can navigate on tap. */}
      <BuzzProvider>
        <DMProvider>
          <Routes>
            {/* Messenger layout: chat list + active pane (landing page when logged out) */}
            <Route element={<AppShell />}>
              <Route path="/" element={<Index />} />
              <Route path="/chat/:id" element={<ChatPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
            {/* Group invite links: /join/<group npub>#k=… */}
            <Route path="/join/:npub" element={<JoinPage />} />
            {/* NIP-19 route for npub1, note1, naddr1, nevent1, nprofile1 */}
            <Route path="/:nip19" element={<NIP19Page />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </DMProvider>
      </BuzzProvider>
    </BrowserRouter>
  );
}
export default AppRouter;
