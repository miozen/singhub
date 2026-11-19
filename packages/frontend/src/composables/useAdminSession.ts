import { ref } from 'vue';
import { clearAuthToken, hasAuthToken, setAuthToken } from '../api/client';
import { getErrorMessage, isUnauthorizedError } from '../api/errors';
import { login as loginApi } from '../api/auth';

type ToastType = 'success' | 'error' | 'info';

type SessionHooks = {
  notify?: (message: string, type?: ToastType) => void;
  onLoginSuccess?: () => Promise<void> | void;
  onLogout?: () => void;
};

export function useAdminSession(hooks: SessionHooks = {}) {
  const password = ref('');
  const authLoading = ref(false);
  const isAuthed = ref(hasAuthToken());

  const initializeSession = () => {
    isAuthed.value = hasAuthToken();
  };

  const logout = (options?: { message?: string; type?: ToastType }) => {
    clearAuthToken();
    isAuthed.value = false;
    password.value = '';
    hooks.onLogout?.();
    if (options?.message) hooks.notify?.(options.message, options.type || 'info');
  };

  const login = async () => {
    authLoading.value = true;
    try {
      const data = await loginApi(password.value);
      setAuthToken(data.token);
      isAuthed.value = true;
      password.value = '';
      try { await hooks.onLoginSuccess?.(); } catch { /* 登录后预加载失败不应回滚已成功的登录态 */ }
      hooks.notify?.('登录成功', 'success');
      return true;
    } catch (error) {
      hooks.notify?.(getErrorMessage(error, '登录失败'), 'error');
      return false;
    } finally {
      authLoading.value = false;
    }
  };

  const handleAuthError = (error: unknown) => {
    if (!isUnauthorizedError(error)) return false;
    logout({ message: '登录已失效，请重新登录', type: 'error' });
    return true;
  };

  return {
    password,
    authLoading,
    isAuthed,
    initializeSession,
    login,
    logout,
    handleAuthError
  };
}
