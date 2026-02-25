import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isAdminEmail } from '@/lib/admin';
import { getAgentSettings } from '@/lib/agent-settings';
import { AdminSettingsForm } from './settings-form';

export default async function AdminSettingsPage() {
  const session = await getServerSession(authOptions);
  if (!isAdminEmail(session?.user?.email)) {
    notFound();
  }

  const settings = await getAgentSettings();

  return (
    <div className="flex-1 min-h-0 overflow-auto bg-gray-50/40 dark:bg-gray-900/30">
      <div className="max-w-5xl mx-auto p-6 md:p-8 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Agent 管理后台</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              配置各转换功能的模型与角色 Prompt，并设置 OpenRouter AK。
            </p>
          </div>
          <Link
            href="/"
            className="px-3 py-2 rounded-md bg-gray-200 dark:bg-gray-700 text-sm hover:bg-gray-300 dark:hover:bg-gray-600"
          >
            返回项目面板
          </Link>
        </div>
        <AdminSettingsForm initialSettings={settings} />
      </div>
    </div>
  );
}
