'use client';

type KnowledgeDocCreateButtonProps = {
  onClick: () => void;
  compact?: boolean;
  className?: string;
};

export function KnowledgeDocCreateButton({
  onClick,
  compact = false,
  className = '',
}: KnowledgeDocCreateButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center justify-center rounded-[12px] bg-black text-white shadow-sm transition hover:bg-black/92 ${compact ? 'h-8 px-3' : 'h-10 px-4'} ${className}`.trim()}
    >
      <span className={compact ? 'text-[11px] font-medium' : 'text-sm font-medium'}>创建知识文档</span>
    </button>
  );
}
