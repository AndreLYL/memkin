import { Link } from "react-router";
import { getTypeBgClass } from "../../lib/type-groups";

interface EntityBadgeProps {
  type: string;
  slug?: string;
  label?: string;
  clickable?: boolean;
}

export function EntityBadge({ type, slug, label, clickable = true }: EntityBadgeProps) {
  const classes = `inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium uppercase tracking-wide ${getTypeBgClass(type)}`;
  const text = label ?? type;

  if (clickable && slug) {
    return (
      <Link to={`/entity/${encodeURIComponent(slug)}`} className={`${classes} hover:opacity-80`}>
        {text}
      </Link>
    );
  }
  return <span className={classes}>{text}</span>;
}
