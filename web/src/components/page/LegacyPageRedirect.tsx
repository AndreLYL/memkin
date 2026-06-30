import { Navigate, useParams, useLocation } from "react-router";
import { legacyToEntityPath } from "../../lib/legacy-redirect";

export function LegacyPageRedirect() {
  const params = useParams();
  const location = useLocation();
  const slug = params["*"] ?? "";
  return <Navigate to={legacyToEntityPath(slug, location.search, location.hash)} replace />;
}
