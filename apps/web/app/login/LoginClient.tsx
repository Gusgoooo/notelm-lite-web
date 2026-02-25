'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

export function LoginClient() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const callbackUrl = searchParams.get('callbackUrl') || '/';
      const res = await signIn('credentials', {
        email: email.trim().toLowerCase(),
        password,
        callbackUrl,
        redirect: false,
      });
      if (res?.error) {
        if (res.error === 'CredentialsSignin') {
          setError('邮箱或密码错误');
        } else if (res.error.toLowerCase().includes('csrf')) {
          setError('登录会话已过期，请刷新页面后重试');
        } else {
          setError(`登录失败：${res.error}`);
        }
        return;
      }
      if (res?.ok) {
        window.location.href = callbackUrl;
        return;
      }
      setError('登录失败，请稍后重试');
    } catch (e) {
      setError(e instanceof Error ? `登录失败：${e.message}` : '登录失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const currentCallback = searchParams.get('callbackUrl');

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900 px-4">
      <div className="w-full max-w-sm rounded-lg bg-white dark:bg-gray-800 shadow p-6">
        <h1 className="text-xl font-semibold text-center text-gray-800 dark:text-gray-100 mb-4">
          登录 NotebookGo
        </h1>
        {currentCallback && (
          <p className="mb-3 text-xs text-gray-500 dark:text-gray-400 break-all">
            登录后将跳转到：{currentCallback}
          </p>
        )}
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              邮箱
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              密码
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm"
            />
          </div>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 rounded bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900 font-medium text-sm disabled:opacity-50"
          >
            {loading ? '登录中…' : '登录'}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-gray-500 dark:text-gray-400">
          还没有账号？{' '}
          <Link href="/register" className="text-blue-600 dark:text-blue-400 hover:underline">
            注册
          </Link>
        </p>
      </div>
    </div>
  );
}

