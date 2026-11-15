import { useSeoMeta } from "@unhead/react";
import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";

import { BeeMark } from "@/components/brand/Brand";
import { Button } from "@/components/ui/button";

const NotFound = () => {
  const location = useLocation();

  useSeoMeta({
    title: "404 · nostr.buzz",
    description: "The page you are looking for could not be found. Return to your chats.",
  });

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname
    );
  }, [location.pathname]);

  return (
    <div className="chat-wallpaper flex min-h-dvh items-center justify-center p-6">
      <div className="text-center">
        <BeeMark className="bee-float mx-auto size-24" />
        <h1 className="mt-4 font-display text-6xl font-extrabold tracking-tight">404</h1>
        <p className="mt-2 text-lg text-muted-foreground">This bee flew off. The page you're looking for doesn't exist.</p>
        <Button asChild className="mt-6 rounded-full px-6">
          <Link to="/">Back to chats</Link>
        </Button>
      </div>
    </div>
  );
};

export default NotFound;
