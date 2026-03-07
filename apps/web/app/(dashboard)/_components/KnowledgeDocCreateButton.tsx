'use client';

import ShinyText from '@/components/ShinyText';

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
      <ShinyText
        text="创建知识文档"
        color="#ffffff"
        shineColor="#d4d4d8"
        speed={3.2}
        spread={120}
        className={compact ? 'text-[11px] font-medium' : 'text-sm font-medium'}
      />
    </button>
  );
}
