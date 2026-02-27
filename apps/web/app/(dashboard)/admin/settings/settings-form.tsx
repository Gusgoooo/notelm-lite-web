'use client';

import { useMemo, useState } from 'react';

type FeatureMode = 'summary' | 'mindmap' | 'infographic' | 'webpage' | 'paper_outline' | 'report';

type AgentSettings = {
  openrouterApiKey: string;
  openrouterBaseUrl: string;
  models: Record<FeatureMode, string>;
  prompts: Record<FeatureMode, string>;
  paperOutlineFormats: string[];
};

const MODE_LABELS: Array<{ mode: FeatureMode; label: string }> = [
  { mode: 'summary', label: '简化成摘要' },
  { mode: 'mindmap', label: '转换成思维导图' },
  { mode: 'infographic', label: '转换成信息图' },
  { mode: 'webpage', label: '生成互动PPT' },
  { mode: 'paper_outline', label: '撰写论文大纲' },
  { mode: 'report', label: '生成报告' },
];

export function AdminSettingsForm({ initialSettings }: { initialSettings: AgentSettings }) {
  const [form, setForm] = useState<AgentSettings>(initialSettings);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(initialSettings),
    [form, initialSettings]
  );

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setStatus('');
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data?.error ?? '保存失败');
        return;
      }
      setForm(data);
      setStatus('保存成功');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 md:p-5 space-y-5">
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">OpenRouter 连接配置</h2>
        <label className="block text-xs text-gray-500 dark:text-gray-400">OpenRouter API Key</label>
        <input
          value={form.openrouterApiKey}
          onChange={(e) => setForm((prev) => ({ ...prev, openrouterApiKey: e.target.value }))}
          type="password"
          placeholder="sk-or-v1-..."
          className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
        />
        <label className="block text-xs text-gray-500 dark:text-gray-400">OpenRouter Base URL</label>
        <input
          value={form.openrouterBaseUrl}
          onChange={(e) => setForm((prev) => ({ ...prev, openrouterBaseUrl: e.target.value }))}
          placeholder="https://openrouter.ai/api/v1"
          className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {MODE_LABELS.map(({ mode, label }) => (
          <div key={mode} className="rounded border border-gray-200 dark:border-gray-700 p-3 space-y-2">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200">{label}</h3>
            <label className="block text-xs text-gray-500 dark:text-gray-400">模型</label>
            <input
              value={form.models[mode]}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  models: { ...prev.models, [mode]: e.target.value },
                }))
              }
              placeholder="模型 ID"
              className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
            />
            <label className="block text-xs text-gray-500 dark:text-gray-400">Role Prompt</label>
            <textarea
              value={form.prompts[mode]}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  prompts: { ...prev.prompts, [mode]: e.target.value },
                }))
              }
              rows={5}
              className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm resize-y"
            />
          </div>
        ))}
      </div>

      <div className="rounded border border-gray-200 dark:border-gray-700 p-3 space-y-2">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200">论文大纲格式选项</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          每行一个格式，前端会在“撰写论文大纲”前让用户选择。
        </p>
        <textarea
          value={form.paperOutlineFormats.join('\n')}
          onChange={(e) =>
            setForm((prev) => ({
              ...prev,
              paperOutlineFormats: e.target.value
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean)
                .slice(0, 12),
            }))
          }
          rows={5}
          className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm resize-y"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || !dirty}
          className="px-4 py-2 rounded-md bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 text-sm font-medium disabled:opacity-50"
        >
          {saving ? '保存中…' : '保存配置'}
        </button>
        {status && (
          <p
            className={`text-xs ${
              status === '保存成功'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-red-600 dark:text-red-400'
            }`}
          >
            {status}
          </p>
        )}
      </div>
    </div>
  );
}
