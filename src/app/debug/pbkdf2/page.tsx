'use client';

import { useState } from 'react';

const ITERATIONS_LIST = [1000, 10000, 100000, 200000];
const SHA512_LIST = [100000, 100001];

interface TestResult {
  algorithm?: string;
  hash?: string;
  outputBits?: number;
  iterations: number;
  getRandomValues: string;
  importKey: string;
  deriveBits: string;
  result: string;
  substep?: string;
  errorName?: string;
  errorMessage?: string;
  elapsedMs: number;
  hashLen?: number;
  hashHexPrefix?: string;
}

interface BatchResult {
  algorithm: string;
  hash: string;
  saltBytes: number;
  outputBits: number;
  results: TestResult[];
}

export default function Pbkdf2DiagPage() {
  const [workerUrl, setWorkerUrl] = useState('');
  const [serviceKey, setServiceKey] = useState('');
  const [sha256Results, setSha256Results] = useState<TestResult[]>([]);
  const [sha512Results, setSha512Results] = useState<TestResult[]>([]);
  const [argon2Result, setArgon2Result] = useState<any>(null);
  const [argon2VerifyResult, setArgon2VerifyResult] = useState<any>(null);
  const [argon2WasmResult, setArgon2WasmResult] = useState<any>(null);
  const [loading, setLoading] = useState<'none' | 'sha256' | 'sha512' | 'argon2' | 'argon2wasm'>('none');
  const [error, setError] = useState('');

  const runSha256Test = async () => {
    if (!workerUrl || !serviceKey) {
      setError('请填写 Worker URL 和 Service Key');
      return;
    }
    setLoading('sha256');
    setError('');
    setSha256Results([]);
    try {
      const base = workerUrl.replace(/\/$/, '');
      const list = ITERATIONS_LIST.join(',');
      const res = await fetch(`${base}/debug/pbkdf2/batch?list=${list}`, {
        method: 'GET',
        headers: { 'X-SRC-Service-Key': serviceKey },
      });
      const data = (await res.json()) as BatchResult | { error: string };
      if ('error' in data) {
        setError(data.error);
      } else if ('results' in data) {
        setSha256Results(data.results);
      } else {
        setError('Unexpected response format');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading('none');
    }
  };

  const runSha512Test = async () => {
    if (!workerUrl || !serviceKey) {
      setError('请填写 Worker URL 和 Service Key');
      return;
    }
    setLoading('sha512');
    setError('');
    setSha512Results([]);
    try {
      const base = workerUrl.replace(/\/$/, '');
      const list = SHA512_LIST.join(',');
      const res = await fetch(`${base}/debug/pbkdf2/sha512/batch?list=${list}`, {
        method: 'GET',
        headers: { 'X-SRC-Service-Key': serviceKey },
      });
      const data = (await res.json()) as BatchResult | { error: string };
      if ('error' in data) {
        setError(data.error);
      } else if ('results' in data) {
        setSha512Results(data.results);
      } else {
        setError('Unexpected response format');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading('none');
    }
  };

  const runArgon2Test = async () => {
    if (!workerUrl || !serviceKey) {
      setError('请填写 Worker URL 和 Service Key');
      return;
    }
    setLoading('argon2');
    setError('');
    setArgon2Result(null);
    setArgon2VerifyResult(null);
    try {
      const base = workerUrl.replace(/\/$/, '');
      const res = await fetch(`${base}/debug/argon2`, {
        method: 'GET',
        headers: { 'X-SRC-Service-Key': serviceKey },
      });
      const data = await res.json();
      if ('error' in data) {
        setError(data.error);
      } else {
        setArgon2Result(data);
      }

      // Also test verify
      const res2 = await fetch(`${base}/debug/argon2/verify`, {
        method: 'GET',
        headers: { 'X-SRC-Service-Key': serviceKey },
      });
      const data2 = await res2.json();
      if (!('error' in data2)) {
        setArgon2VerifyResult(data2);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading('none');
    }
  };

  const runArgon2WasmTest = async () => {
    if (!workerUrl || !serviceKey) {
      setError('请填写 Worker URL 和 Service Key');
      return;
    }
    setLoading('argon2wasm');
    setError('');
    setArgon2WasmResult(null);
    try {
      const base = workerUrl.replace(/\/$/, '');
      const res = await fetch(`${base}/debug/argon2-wasm`, {
        method: 'GET',
        headers: { 'X-SRC-Service-Key': serviceKey },
      });
      const data = await res.json();
      if ('error' in data) {
        setError(data.error);
      } else {
        setArgon2WasmResult(data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading('none');
    }
  };

  const renderTable = (results: TestResult[], title: string) => (
    <div style={{ marginBottom: 30 }}>
      <h2>{title}</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ background: '#eee' }}>
            <th style={{ padding: 8, textAlign: 'left', border: '1px solid #ddd' }}>iterations</th>
            <th style={{ padding: 8, textAlign: 'center', border: '1px solid #ddd' }}>getRandomValues</th>
            <th style={{ padding: 8, textAlign: 'center', border: '1px solid #ddd' }}>importKey</th>
            <th style={{ padding: 8, textAlign: 'center', border: '1px solid #ddd' }}>deriveBits</th>
            <th style={{ padding: 8, textAlign: 'center', border: '1px solid #ddd' }}>Result</th>
            <th style={{ padding: 8, textAlign: 'center', border: '1px solid #ddd' }}>elapsed</th>
            <th style={{ padding: 8, textAlign: 'left', border: '1px solid #ddd' }}>details</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r, i) => (
            <tr key={i}>
              <td style={{ padding: 8, border: '1px solid #ddd', fontWeight: 600 }}>{r.iterations.toLocaleString()}</td>
              <td style={{ padding: 8, textAlign: 'center', border: '1px solid #ddd', color: r.getRandomValues === 'PASS' ? '#2e7d32' : '#c62828' }}>{r.getRandomValues}</td>
              <td style={{ padding: 8, textAlign: 'center', border: '1px solid #ddd', color: r.importKey === 'PASS' ? '#2e7d32' : '#c62828' }}>{r.importKey}</td>
              <td style={{ padding: 8, textAlign: 'center', border: '1px solid #ddd', color: r.deriveBits === 'PASS' ? '#2e7d32' : '#c62828', fontWeight: 600 }}>{r.deriveBits}</td>
              <td style={{ padding: 8, textAlign: 'center', border: '1px solid #ddd', fontWeight: 600, color: r.result === 'PASS' ? '#2e7d32' : '#c62828' }}>{r.result}</td>
              <td style={{ padding: 8, textAlign: 'center', border: '1px solid #ddd' }}>{r.elapsedMs} ms</td>
              <td style={{ padding: 8, border: '1px solid #ddd', fontSize: 12, color: '#555' }}>
                {r.result === 'PASS' ? (
                  <span>hash_len={r.hashLen}, prefix={r.hashHexPrefix}</span>
                ) : (
                  <span>
                    substep: <code>{r.substep}</code><br />
                    error: <strong>{r.errorName}</strong><br />
                    {r.errorMessage}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div style={{ maxWidth: 900, margin: '40px auto', padding: '0 20px', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
      <h1>PBKDF2 Production Runtime Test</h1>
      <p style={{ color: '#666' }}>
        单变量测试：SHA-256 vs SHA-512，其他参数固定为 PBKDF2 / 16-byte salt。
      </p>

      <div style={{ background: '#f5f5f5', padding: 20, borderRadius: 8, marginBottom: 20 }}>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
            Worker URL
          </label>
          <input
            type="text"
            value={workerUrl}
            onChange={(e) => setWorkerUrl(e.target.value)}
            placeholder="https://src-primary-api.xxx.workers.dev"
            style={{ width: '100%', padding: 8, fontSize: 14, borderRadius: 4, border: '1px solid #ccc' }}
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
            X-SRC-Service-Key
          </label>
          <input
            type="password"
            value={serviceKey}
            onChange={(e) => setServiceKey(e.target.value)}
            placeholder="Service Key"
            style={{ width: '100%', padding: 8, fontSize: 14, borderRadius: 4, border: '1px solid #ccc' }}
          />
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button
            onClick={runSha256Test}
            disabled={loading !== 'none'}
            style={{
              padding: '10px 24px',
              fontSize: 16,
              background: '#2196F3',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: loading !== 'none' ? 'not-allowed' : 'pointer',
            }}
          >
            {loading === 'sha256' ? '测试中...' : 'SHA-256 (4 iterations)'}
          </button>
          <button
            onClick={runSha512Test}
            disabled={loading !== 'none'}
            style={{
              padding: '10px 24px',
              fontSize: 16,
              background: '#4CAF50',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: loading !== 'none' ? 'not-allowed' : 'pointer',
            }}
          >
            {loading === 'sha512' ? '测试中...' : 'SHA-512 (100k / 100001)'}
          </button>

          <button
            onClick={runArgon2Test}
            disabled={loading !== 'none'}
            style={{
              padding: '12px 20px',
              fontSize: 14,
              background: loading === 'argon2' ? '#999' : '#6a1b9a',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: loading !== 'none' ? 'not-allowed' : 'pointer',
            }}
          >
            {loading === 'argon2' ? '测试中...' : 'Argon2id (19 MiB / t=2)'}
          </button>

          <button
            onClick={runArgon2WasmTest}
            disabled={loading !== 'none'}
            style={{
              padding: '12px 20px',
              fontSize: 14,
              background: loading === 'argon2wasm' ? '#999' : '#00695c',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: loading !== 'none' ? 'not-allowed' : 'pointer',
            }}
          >
            {loading === 'argon2wasm' ? '测试中...' : 'Argon2id WASM (precompiled)'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: '#ffebee', padding: 16, borderRadius: 8, color: '#c62828', marginBottom: 20 }}>
        <strong>错误：</strong> {error}
      </div>
      )}

      {sha256Results.length > 0 && renderTable(sha256Results, 'PBKDF2-HMAC-SHA256 / 256-bit output')}
      {sha512Results.length > 0 && renderTable(sha512Results, 'PBKDF2-HMAC-SHA-512 / 512-bit output')}

      {argon2Result && (
        <div style={{ marginBottom: 30 }}>
          <h2>Argon2id (WASM / hash-wasm) 测试结果</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#eee' }}>
                <th style={{ padding: 8, textAlign: 'left', border: '1px solid #ddd' }}>配置</th>
                <th style={{ padding: 8, textAlign: 'center', border: '1px solid #ddd' }}>Success</th>
                <th style={{ padding: 8, textAlign: 'center', border: '1px solid #ddd' }}>elapsed</th>
                <th style={{ padding: 8, textAlign: 'left', border: '1px solid #ddd' }}>details</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ padding: 8, border: '1px solid #ddd', fontWeight: 600 }}>
                  OWASP min (19 MiB, t=2, p=1)
                </td>
                <td style={{ padding: 8, textAlign: 'center', border: '1px solid #ddd', fontWeight: 600, color: argon2Result.owaspMin?.success ? '#2e7d32' : '#c62828' }}>
                  {argon2Result.owaspMin?.success ? 'PASS' : 'FAIL'}
                </td>
                <td style={{ padding: 8, textAlign: 'center', border: '1px solid #ddd' }}>{argon2Result.owaspMin?.elapsedMs} ms</td>
                <td style={{ padding: 8, border: '1px solid #ddd', fontSize: 12, color: '#555' }}>
                  {argon2Result.owaspMin?.success ? (
                    <span>hash_len={argon2Result.owaspMin?.hashLength}, prefix={argon2Result.owaspMin?.hashPrefix}</span>
                  ) : (
                    <span>
                      error: <strong>{argon2Result.owaspMin?.errorName}</strong><br />
                      {argon2Result.owaspMin?.errorMessage}
                    </span>
                  )}
                </td>
              </tr>
              <tr>
                <td style={{ padding: 8, border: '1px solid #ddd', fontWeight: 600 }}>
                  Low (1 MiB, t=1, p=1)
                </td>
                <td style={{ padding: 8, textAlign: 'center', border: '1px solid #ddd', fontWeight: 600, color: argon2Result.lowParams?.success ? '#2e7d32' : '#c62828' }}>
                  {argon2Result.lowParams?.success ? 'PASS' : 'FAIL'}
                </td>
                <td style={{ padding: 8, textAlign: 'center', border: '1px solid #ddd' }}>{argon2Result.lowParams?.elapsedMs} ms</td>
                <td style={{ padding: 8, border: '1px solid #ddd', fontSize: 12, color: '#555' }}>
                  {argon2Result.lowParams?.success ? (
                    <span>hash_len={argon2Result.lowParams?.hashLength}, prefix={argon2Result.lowParams?.hashPrefix}</span>
                  ) : (
                    <span>
                      error: <strong>{argon2Result.lowParams?.errorName}</strong><br />
                      {argon2Result.lowParams?.errorMessage}
                    </span>
                  )}
                </td>
              </tr>
            </tbody>
          </table>

          {argon2VerifyResult && (
            <div style={{ marginTop: 16, padding: 12, background: '#f3e5f5', borderRadius: 8 }}>
              <strong>Verify 测试：</strong>{' '}
              {argon2VerifyResult.hashSuccess ? 'hash PASS' : 'hash FAIL'}
              {' / '}
              {argon2VerifyResult.verifySuccess ? 'verify PASS' : 'verify FAIL'}
              {' / match: '}
              <strong>{argon2VerifyResult.match ? 'YES' : 'NO'}</strong>
              {' / '}
              {argon2VerifyResult.elapsedMs} ms
              {argon2VerifyResult.errorName && (
                <div style={{ color: '#c62828', marginTop: 4 }}>
                  error: <strong>{argon2VerifyResult.errorName}</strong> — {argon2VerifyResult.errorMessage}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {argon2WasmResult && (
        <div style={{ marginBottom: 30 }}>
          <h2>Argon2id (预编译 WASM / wasm_modules) 测试结果</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#eee' }}>
                <th style={{ padding: 8, textAlign: 'left', border: '1px solid #ddd' }}>配置</th>
                <th style={{ padding: 8, textAlign: 'center', border: '1px solid #ddd' }}>Success</th>
                <th style={{ padding: 8, textAlign: 'center', border: '1px solid #ddd' }}>elapsed</th>
                <th style={{ padding: 8, textAlign: 'left', border: '1px solid #ddd' }}>details</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ padding: 8, border: '1px solid #ddd', fontWeight: 600 }}>
                  OWASP min (19 MiB, t=2, p=1)
                </td>
                <td style={{ padding: 8, textAlign: 'center', border: '1px solid #ddd', fontWeight: 600, color: argon2WasmResult.owaspMin?.success ? '#2e7d32' : '#c62828' }}>
                  {argon2WasmResult.owaspMin?.success ? 'PASS' : 'FAIL'}
                </td>
                <td style={{ padding: 8, textAlign: 'center', border: '1px solid #ddd' }}>{argon2WasmResult.owaspMin?.elapsedMs} ms</td>
                <td style={{ padding: 8, border: '1px solid #ddd', fontSize: 12, color: '#555' }}>
                  {argon2WasmResult.owaspMin?.success ? (
                    <span>hash_len={argon2WasmResult.owaspMin?.hashLength}, prefix={argon2WasmResult.owaspMin?.hashPrefix}{argon2WasmResult.owaspMin?.initElapsedMs !== undefined ? `, init=${argon2WasmResult.owaspMin.initElapsedMs}ms` : ''}</span>
                  ) : (
                    <span>
                      error: <strong>{argon2WasmResult.owaspMin?.errorName}</strong><br />
                      {argon2WasmResult.owaspMin?.errorMessage}
                    </span>
                  )}
                </td>
              </tr>
              <tr>
                <td style={{ padding: 8, border: '1px solid #ddd', fontWeight: 600 }}>
                  Low (1 MiB, t=1, p=1)
                </td>
                <td style={{ padding: 8, textAlign: 'center', border: '1px solid #ddd', fontWeight: 600, color: argon2WasmResult.lowParams?.success ? '#2e7d32' : '#c62828' }}>
                  {argon2WasmResult.lowParams?.success ? 'PASS' : 'FAIL'}
                </td>
                <td style={{ padding: 8, textAlign: 'center', border: '1px solid #ddd' }}>{argon2WasmResult.lowParams?.elapsedMs} ms</td>
                <td style={{ padding: 8, border: '1px solid #ddd', fontSize: 12, color: '#555' }}>
                  {argon2WasmResult.lowParams?.success ? (
                    <span>hash_len={argon2WasmResult.lowParams?.hashLength}, prefix={argon2WasmResult.lowParams?.hashPrefix}</span>
                  ) : (
                    <span>
                      error: <strong>{argon2WasmResult.lowParams?.errorName}</strong><br />
                      {argon2WasmResult.lowParams?.errorMessage}
                    </span>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 40, paddingTop: 20, borderTop: '1px solid #eee', color: '#999', fontSize: 12 }}>
        <p>
          <strong>说明：</strong>本页面仅用于只读诊断 PBKDF2 运行时行为，不处理任何真实用户数据，
          不修改数据库，测试密码固定为 "test-password"。问题排查完成后应移除此端点。
        </p>
      </div>
    </div>
  );
}
