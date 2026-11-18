import { create } from 'zustand'
import { authAPI, adminAPI, licenseAPI, usersAPI } from '../services/api'

export const useAuthStore = create((set, get) => ({
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  token: localStorage.getItem('token'),
  isAuthenticated: !!localStorage.getItem('token'),
  isConfigured: null,
  brand: null,
  licenseValid: null,
  licenseInfo: null,

  setAuth: (user, token) => {
    localStorage.setItem('user', JSON.stringify(user))
    if (token) localStorage.setItem('token', token)
    set({ user, token: token || get().token, isAuthenticated: true })
  },

  setUser: (user) => {
    localStorage.setItem('user', JSON.stringify(user))
    set({ user })
  },

  updateCurrentUser: (updates) => {
    const current = get().user || {}
    const updated = { ...current, ...updates }
    localStorage.setItem('user', JSON.stringify(updated))
    set({ user: updated })
  },

  fetchCurrentUser: async () => {
    const token = get().token || localStorage.getItem('token')
    if (!token) return null
    try {
      const { data } = await usersAPI.getMe()
      if (data) {
        localStorage.setItem('user', JSON.stringify(data))
        set({ user: data, isAuthenticated: true })
        return data
      }
    } catch (err) {
      if (err.response?.status === 401) {
        get().logout()
      }
    }
    return null
  },

  logout: () => {
    localStorage.removeItem('user')
    localStorage.removeItem('token')
    set({ user: null, token: null, isAuthenticated: false, licenseValid: null, licenseInfo: null })
  },

  checkSetup: async () => {
    try {
      const { data } = await authAPI.getSetupStatus()
      set({ isConfigured: data.is_configured, licenseValid: data.license_activated })
      return data.is_configured
    } catch {
      set({ isConfigured: false })
      return false
    }
  },

  loadBrand: async () => {
    try {
      const { data } = await adminAPI.getBranding()
      set({ brand: data })
      return data
    } catch {
      return null
    }
  },

  checkLicense: async () => {
    try {
      const { data } = await licenseAPI.getStatus()
      set({ licenseValid: data.is_valid, licenseInfo: data })
      return data.is_valid
    } catch {
      set({ licenseValid: false })
      return false
    }
  },

  completeSetup: async (setupData) => {
    const { data } = await authAPI.completeSetup(setupData)
    set({ isConfigured: true })
    return data
  },

  login: async (username, password) => {
    const { data } = await authAPI.login({ username, password })
    get().setAuth(data.user, data.access_token)
    return data.user
  },
}))
