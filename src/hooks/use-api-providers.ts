'use client'

import { useState, useEffect, useCallback } from 'react'
import type { ApiProvider, ApiProviderStatus, ProviderProtocol } from '@/lib/types'

interface DbApiProvider {
  id: string
  name: string
  provider: string
  protocol: string
  api_key: string
  base_url: string
  model_name: string
  is_active: number
  status: string
  status_error: string
  created_at: string
  updated_at: string
}

function mapProvider(row: DbApiProvider): ApiProvider {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider as ApiProvider['provider'],
    protocol: (row.protocol || 'anthropic-compatible') as ProviderProtocol,
    apiKey: row.api_key,
    baseUrl: row.base_url,
    modelName: row.model_name || '',
    isActive: row.is_active === 1,
    status: (row.status || 'not_configured') as ApiProviderStatus,
    statusError: row.status_error || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function useApiProviders() {
  const [providers, setProviders] = useState<ApiProvider[]>([])
  const [loading, setLoading] = useState(true)

  const fetchProviders = useCallback(async () => {
    try {
      const res = await fetch('/api/api-providers')
      const data = (await res.json()) as DbApiProvider[]
      setProviders(data.map(mapProvider))
    } catch (err) {
      console.error('Failed to fetch API providers:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchProviders() }, [fetchProviders])

  const updateProvider = useCallback(async (id: string, updates: Record<string, unknown>) => {
    const res = await fetch(`/api/api-providers/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    if (!res.ok) throw new Error(`Failed to update provider: ${res.status}`)
    const data = mapProvider(await res.json())
    setProviders((prev) => prev.map((p) => (p.id === id ? data : p)))
    return data
  }, [])

  const testConnection = useCallback(async (id: string) => {
    // Optimistic: set testing state locally
    setProviders((prev) => prev.map((p) => p.id === id ? { ...p, status: 'testing' as ApiProviderStatus, statusError: '' } : p))
    try {
      const res = await fetch(`/api/api-providers/${id}/test`, { method: 'POST' })
      const data = await res.json()
      const updated = mapProvider(data)
      setProviders((prev) => prev.map((p) => (p.id === id ? updated : p)))
      return updated
    } catch {
      setProviders((prev) => prev.map((p) => p.id === id ? { ...p, status: 'error' as ApiProviderStatus, statusError: 'Network error' } : p))
      return null
    }
  }, [])

  const createProvider = useCallback(async (data: { name: string; baseUrl: string; apiKey: string; modelName: string; protocol: ProviderProtocol }) => {
    const res = await fetch('/api/api-providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) throw new Error(`Failed to create provider: ${res.status}`)
    const created = mapProvider(await res.json() as DbApiProvider)
    setProviders((prev) => [...prev, created])
    return created
  }, [])

  const deleteProvider = useCallback(async (id: string) => {
    const res = await fetch(`/api/api-providers/${id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error(`Failed to delete provider: ${res.status}`)
    setProviders((prev) => prev.filter((p) => p.id !== id))
  }, [])

  return { providers, loading, updateProvider, testConnection, createProvider, deleteProvider, refreshProviders: fetchProviders }
}
