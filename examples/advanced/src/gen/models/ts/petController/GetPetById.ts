import type { Pet } from '../Pet'

/**
 * @description Invalid ID supplied
 */
export type GetPetById400 = any | null

/**
 * @description Pet not found
 */
export type GetPetById404 = any | null

export type GetPetByIdPathParams = {
  /**
   * @type integer int64
   */
  petId: number
}

/**
 * @description successful operation
 */
export type GetPetByIdResponse = Pet