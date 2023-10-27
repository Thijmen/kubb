import { useMutation } from '@tanstack/vue-query'
import client from '@kubb/swagger-client/client'
import type { KubbQueryFactory } from './types'
import type { UseMutationOptions, UseMutationReturnType } from '@tanstack/vue-query'
import type { ResponseConfig } from '@kubb/swagger-client/client'
import type { CreateUserMutationResponse } from '../models/CreateUser'

type CreateUser = KubbQueryFactory<
  CreateUserMutationResponse,
  never,
  never,
  never,
  never,
  CreateUserMutationResponse,
  {
    dataReturnType: 'data'
    type: 'mutation'
  }
> /**
 * @description This can only be done by the logged in user.
 * @summary Create user
 * @link /user
 */

export function useCreateUser<TData = CreateUser['response'], TError = CreateUser['error'], TVariables = CreateUser['request']>(
  options: {
    mutation?: UseMutationOptions<ResponseConfig<TData>, TError, TVariables, unknown>
    client?: CreateUser['client']['paramaters']
  } = {},
): UseMutationReturnType<ResponseConfig<TData>, TError, TVariables, unknown> {
  const { mutation: mutationOptions, client: clientOptions = {} } = options ?? {}
  return useMutation<ResponseConfig<TData>, TError, TVariables, unknown>({
    mutationFn: (data) => {
      return client<TData, TError, TVariables>({
        method: 'post',
        url: `/user`,
        data,
        ...clientOptions,
      })
    },
    ...mutationOptions,
  })
}