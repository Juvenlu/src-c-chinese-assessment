'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email.trim()) {
      setSubmitted(true);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--color-src-bg)] py-8 px-4 flex items-center justify-center">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2" style={{ fontFamily: "'ZCOOL KuaiLe', cursive", color: 'var(--color-src-primary)' }}>
            忘记密码
          </h1>
          <p className="text-gray-600">
            {submitted ? '我们已收到您的请求' : '请联系平台管理员重置密码'}
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-lg p-6">
          {!submitted ? (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="bg-yellow-50 text-yellow-800 px-4 py-3 rounded-xl text-sm">
                <p className="font-medium mb-1">🔐 账户安全提示</p>
                <p className="text-yellow-700">
                  为了保护您的账户安全，我们暂不提供自助密码重置。
                  请通过以下方式联系平台管理员，核实身份后为您重置密码。
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  您的注册邮箱
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="example@email.com"
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-orange-400 focus:outline-none transition-colors"
                />
              </div>

              <div className="bg-gray-50 px-4 py-3 rounded-xl text-sm text-gray-600">
                <p className="font-medium text-gray-700 mb-2">📮 联系方式</p>
                <p>请发送邮件至管理员邮箱申请重置密码：</p>
                <p className="font-mono mt-1 text-[var(--color-src-primary)]">support@src-chinese.com</p>
                <p className="mt-2 text-xs text-gray-500">
                  邮件中请注明您的注册邮箱，以及孩子昵称方便核实。
                </p>
              </div>

              <button
                type="submit"
                className="w-full py-3 bg-gray-100 text-gray-600 font-medium rounded-xl hover:bg-gray-200 transition-colors"
              >
                我知道了
              </button>
            </form>
          ) : (
            <div className="text-center space-y-5 py-4">
              <div className="text-5xl">📬</div>
              <div>
                <p className="text-lg font-medium text-gray-800">已记录您的邮箱</p>
                <p className="text-sm text-gray-500 mt-1">{email}</p>
              </div>
              <p className="text-sm text-gray-600 leading-relaxed">
                请使用该邮箱发送邮件至 <br />
                <span className="font-mono text-[var(--color-src-primary)]">support@src-chinese.com</span> <br />
                申请重置密码，我们会尽快处理。
              </p>
              <button
                onClick={() => router.push('/login')}
                className="w-full py-3 bg-[var(--color-src-primary)] text-white font-bold rounded-xl hover:opacity-90 transition-opacity mt-2"
              >
                返回登录
              </button>
            </div>
          )}
        </div>

        <p className="text-center mt-6 text-sm text-gray-600">
          <button onClick={() => router.push('/login')} className="text-[var(--color-src-primary)] hover:underline">
            ← 返回登录
          </button>
        </p>
      </div>
    </div>
  );
}
