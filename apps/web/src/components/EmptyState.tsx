interface Props {
  title: string;
  message: string;
}

/** Reusable empty-state card used across pages while features are pending. */
export default function EmptyState({ title, message }: Props) {
  return (
    <div className="rounded-lg border-2 border-dashed border-gray-300 bg-white p-10 text-center">
      <p className="font-medium text-gray-700">{title}</p>
      <p className="mt-1 text-sm text-gray-500 max-w-md mx-auto">{message}</p>
    </div>
  );
}
