import { Link } from "react-router";
import { Button } from "@/components/ui/button";

export default function NotFoundPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="font-mono text-5xl font-semibold text-fg-faint">404</p>
      <p className="text-sm text-fg-muted">This route does not exist in the control center.</p>
      <Link to="/">
        <Button variant="primary">Back to overview</Button>
      </Link>
    </div>
  );
}
