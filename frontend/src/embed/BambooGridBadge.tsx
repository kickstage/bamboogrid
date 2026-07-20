import "./BambooGridBadge.css";

interface Props {
  editUrl: string;
  name: string;
}

export function BambooGridBadge({ editUrl, name }: Props) {
  return (
    <a
      className="bamboogrid-badge"
      href={editUrl}
      target="_blank"
      rel="noopener noreferrer"
      title={`Edit "${name}" on BambooGrid`}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
        <polyline points="13 2 13 9 20 9" />
      </svg>
      <span>Edit on <strong>BambooGrid</strong></span>
    </a>
  );
}
