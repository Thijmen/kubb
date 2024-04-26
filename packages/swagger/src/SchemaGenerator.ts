import { Generator } from '@kubb/core'
import transformers, { pascalCase } from '@kubb/core/transformers'
import { getUniqueName } from '@kubb/core/utils'

import { isReference } from '@kubb/oas'
import { isDeepEqual, isNumber, uniqueWith } from 'remeda'
import { isKeyword, schemaKeywords } from './SchemaMapper.ts'
import { getSchemaFactory } from './utils/getSchemaFactory.ts'
import { getSchemas } from './utils/getSchemas.ts'

import type { KubbFile, Plugin, PluginFactoryOptions, PluginManager, ResolveNameParams } from '@kubb/core'
import type { Oas, OpenAPIV3, SchemaObject, contentType } from '@kubb/oas'
import type { Schema, SchemaKeywordMapper } from './SchemaMapper.ts'
import type { OperationSchema, Override, Refs } from './types.ts'

export type SchemaMethodResult<TFileMeta extends KubbFile.FileMetaBase> = Promise<KubbFile.File<TFileMeta> | Array<KubbFile.File<TFileMeta>> | null>

type Context<TOptions, TPluginOptions extends PluginFactoryOptions> = {
  oas: Oas
  pluginManager: PluginManager
  /**
   * Current plugin
   */
  plugin: Plugin<TPluginOptions>
  mode: KubbFile.Mode
  include?: Array<'schemas' | 'responses' | 'requestBodies'>
  override: Array<Override<TOptions>> | undefined
  contentType?: contentType
  output?: string
}

export type SchemaGeneratorOptions = {
  dateType: false | 'string' | 'stringOffset' | 'stringLocal' | 'date'
  unknownType: 'any' | 'unknown'
  enumType?: 'enum' | 'asConst' | 'asPascalConst' | 'constEnum' | 'literal'
  enumSuffix?: string
  usedEnumNames?: Record<string, number>
  mapper?: Record<string, string>
  typed?: boolean
  transformers: {
    /**
     * Customize the names based on the type that is provided by the plugin.
     */
    name?: (name: ResolveNameParams['name'], type?: ResolveNameParams['type']) => string
    /**
     * Receive schema and baseName(propertName) and return FakerMeta array
     * TODO TODO add docs
     * @beta
     */
    schema?: (schema: SchemaObject | undefined, baseName?: string) => Schema[] | undefined
  }
}

export type SchemaGeneratorBuildOptions = Omit<OperationSchema, 'name' | 'schema'>

export abstract class SchemaGenerator<
  TOptions extends SchemaGeneratorOptions = SchemaGeneratorOptions,
  TPluginOptions extends PluginFactoryOptions = PluginFactoryOptions,
  TFileMeta extends KubbFile.FileMetaBase = KubbFile.FileMetaBase,
> extends Generator<TOptions, Context<TOptions, TPluginOptions>> {
  // Collect the types of all referenced schemas so we can export them later
  refs: Refs = {}

  // Keep track of already used type aliases
  #usedAliasNames: Record<string, number> = {}

  /**
   * Creates a type node from a given schema.
   * Delegates to getBaseTypeFromSchema internally and
   * optionally adds a union with null.
   */
  buildSchemas(schema: SchemaObject | undefined, baseName?: string): Schema[] {
    const options = this.#getOptions(schema, baseName)

    const schemas = options.transformers?.schema?.(schema, baseName) || this.#parseSchemaObject(schema, baseName) || []

    return uniqueWith<Schema>(schemas, isDeepEqual)
  }

  deepSearch<T extends keyof SchemaKeywordMapper>(schemas: Schema[] | undefined, keyword: T): SchemaKeywordMapper[T][] {
    return SchemaGenerator.deepSearch<T>(schemas, keyword)
  }

  find<T extends keyof SchemaKeywordMapper>(schemas: Schema[] | undefined, keyword: T): SchemaKeywordMapper[T] | undefined {
    return SchemaGenerator.find<T>(schemas, keyword)
  }

  static deepSearch<T extends keyof SchemaKeywordMapper>(schemas: Schema[] | undefined, keyword: T): SchemaKeywordMapper[T][] {
    const foundItems: SchemaKeywordMapper[T][] = []

    schemas?.forEach((schema) => {
      if (schema.keyword === keyword) {
        foundItems.push(schema as SchemaKeywordMapper[T])
      }

      if (schema.keyword === schemaKeywords.object) {
        const subItem = schema as SchemaKeywordMapper['object']

        Object.values(subItem.args?.properties || {}).forEach((entrySchema) => {
          foundItems.push(...SchemaGenerator.deepSearch<T>(entrySchema, keyword))
        })

        Object.values(subItem.args?.additionalProperties || {}).forEach((entrySchema) => {
          foundItems.push(...SchemaGenerator.deepSearch<T>([entrySchema], keyword))
        })
      }

      if (schema.keyword === schemaKeywords.array) {
        const subItem = schema as SchemaKeywordMapper['array']

        subItem.args.items.forEach((entrySchema) => {
          foundItems.push(...SchemaGenerator.deepSearch<T>([entrySchema], keyword))
        })
      }

      if (schema.keyword === schemaKeywords.and) {
        const subItem = schema as SchemaKeywordMapper['and']

        subItem.args.forEach((entrySchema) => {
          foundItems.push(...SchemaGenerator.deepSearch<T>([entrySchema], keyword))
        })
      }

      if (schema.keyword === schemaKeywords.tuple) {
        const subItem = schema as SchemaKeywordMapper['tuple']

        subItem.args.forEach((entrySchema) => {
          foundItems.push(...SchemaGenerator.deepSearch<T>([entrySchema], keyword))
        })
      }

      if (schema.keyword === schemaKeywords.union) {
        const subItem = schema as SchemaKeywordMapper['union']

        subItem.args.forEach((entrySchema) => {
          foundItems.push(...SchemaGenerator.deepSearch<T>([entrySchema], keyword))
        })
      }
    })

    return foundItems
  }

  static find<T extends keyof SchemaKeywordMapper>(schemas: Schema[] | undefined, keyword: T): SchemaKeywordMapper[T] | undefined {
    let foundItem: SchemaKeywordMapper[T] | undefined = undefined

    schemas?.forEach((schema) => {
      if (!foundItem && schema.keyword === keyword) {
        foundItem = schema as SchemaKeywordMapper[T]
      }

      if (schema.keyword === schemaKeywords.array) {
        const subItem = schema as SchemaKeywordMapper['array']

        subItem.args.items.forEach((entrySchema) => {
          if (!foundItem) {
            foundItem = SchemaGenerator.find<T>([entrySchema], keyword)
          }
        })
      }

      if (schema.keyword === schemaKeywords.and) {
        const subItem = schema as SchemaKeywordMapper['and']

        subItem.args.forEach((entrySchema) => {
          if (!foundItem) {
            foundItem = SchemaGenerator.find<T>([entrySchema], keyword)
          }
        })
      }

      if (schema.keyword === schemaKeywords.tuple) {
        const subItem = schema as SchemaKeywordMapper['tuple']

        subItem.args.forEach((entrySchema) => {
          if (!foundItem) {
            foundItem = SchemaGenerator.find<T>([entrySchema], keyword)
          }
        })
      }

      if (schema.keyword === schemaKeywords.union) {
        const subItem = schema as SchemaKeywordMapper['union']

        subItem.args.forEach((entrySchema) => {
          if (!foundItem) {
            foundItem = SchemaGenerator.find<T>([entrySchema], keyword)
          }
        })
      }
    })

    return foundItem
  }

  #getUsedEnumNames(schema: SchemaObject | undefined, baseName: string | undefined) {
    const options = this.#getOptions(schema, baseName)

    return options.usedEnumNames || {}
  }

  #getOptions(_schema: SchemaObject | undefined, baseName: string | undefined): Partial<TOptions> {
    const { override = [] } = this.context

    return {
      ...this.options,
      ...(override.find(({ pattern, type }) => {
        if (baseName && type === 'schemaName') {
          return !!baseName.match(pattern)
        }

        return false
      })?.options || {}),
    }
  }

  #getUnknownReturn(schema: SchemaObject | undefined, baseName: string | undefined) {
    const options = this.#getOptions(schema, baseName)

    if (options.unknownType === 'any') {
      return schemaKeywords.any
    }

    return schemaKeywords.unknown
  }

  /**
   * Recursively creates a type literal with the given props.
   */
  #parseProperties(baseSchema?: SchemaObject, baseName?: string): Schema[] {
    const properties = baseSchema?.properties || {}
    const additionalProperties = baseSchema?.additionalProperties
    const required = baseSchema?.required

    const propertiesSchemas = Object.keys(properties)
      .map((name) => {
        const validationFunctions: Schema[] = []
        const schema = properties[name] as SchemaObject
        const resolvedName = this.context.pluginManager.resolveName({
          name: `${baseName || ''} ${name}`,
          pluginKey: this.context.plugin.key,
          type: 'type',
        })

        const isRequired = Array.isArray(required) ? required?.includes(name) : !!required
        const nullable = schema.nullable ?? schema['x-nullable'] ?? false

        validationFunctions.push(...this.buildSchemas(schema, resolvedName))

        if (!isRequired && nullable) {
          validationFunctions.push({ keyword: schemaKeywords.nullish })
        } else if (!isRequired) {
          validationFunctions.push({ keyword: schemaKeywords.optional })
        }

        return {
          [name]: validationFunctions,
        }
      })
      .reduce((acc, curr) => ({ ...acc, ...curr }), {})
    let additionalPropertieschemas: Schema[] = []

    if (additionalProperties) {
      additionalPropertieschemas =
        additionalProperties === true ? [{ keyword: this.#getUnknownReturn(baseSchema, baseName) }] : this.buildSchemas(additionalProperties as SchemaObject)
    }

    return [
      {
        keyword: schemaKeywords.object,
        args: {
          properties: propertiesSchemas,
          additionalProperties: additionalPropertieschemas,
        },
      },
    ]
  }

  /**
   * Create a type alias for the schema referenced by the given ReferenceObject
   */
  #getRefAlias(obj: OpenAPIV3.ReferenceObject, _baseName?: string): Schema[] {
    const { $ref } = obj
    let ref = this.refs[$ref]

    const originalName = getUniqueName($ref.replace(/.+\//, ''), this.#usedAliasNames)
    const propertyName = this.context.pluginManager.resolveName({
      name: originalName,
      pluginKey: this.context.plugin.key,
      type: 'function',
    })

    if (ref) {
      return [
        {
          keyword: schemaKeywords.ref,
          args: { name: ref.propertyName, path: ref.path },
        },
      ]
    }

    const fileName = this.context.pluginManager.resolveName({
      name: originalName,
      pluginKey: this.context.plugin.key,
      type: 'file',
    })
    const path = this.context.pluginManager.resolvePath({
      baseName: fileName,
      pluginKey: this.context.plugin.key,
    })

    ref = this.refs[$ref] = {
      propertyName,
      originalName,
      path,
    }

    return [
      {
        keyword: schemaKeywords.ref,
        args: { name: ref.propertyName, path: ref?.path, isTypeOnly: false },
      },
    ]
  }

  #getParsedSchemaObject(schema?: SchemaObject) {
    const parsedSchema = getSchemaFactory(this.context.oas)(schema)
    return parsedSchema
  }

  /**
   * This is the very core of the OpenAPI to TS conversion - it takes a
   * schema and returns the appropriate type.
   */
  #parseSchemaObject(_schema: SchemaObject | undefined, baseName?: string): Schema[] {
    const options = this.#getOptions(_schema, baseName)
    const unknownReturn = this.#getUnknownReturn(_schema, baseName)
    const { schema, version } = this.#getParsedSchemaObject(_schema)

    if (!schema) {
      return [{ keyword: unknownReturn }]
    }

    const baseItems: Schema[] = [
      {
        keyword: schemaKeywords.schema,
        args: {
          type: schema.type as any,
          format: schema.format,
        },
      },
    ]
    const min = schema.minimum ?? schema.minLength ?? schema.minItems ?? undefined
    const max = schema.maximum ?? schema.maxLength ?? schema.maxItems ?? undefined
    const nullable = schema.nullable ?? schema['x-nullable'] ?? false

    if (schema.default !== undefined && !Array.isArray(schema.default)) {
      if (typeof schema.default === 'string') {
        baseItems.push({
          keyword: schemaKeywords.default,
          args: transformers.stringify(schema.default),
        })
      }
      if (typeof schema.default === 'boolean') {
        baseItems.push({
          keyword: schemaKeywords.default,
          args: schema.default ?? false,
        })
      }
    }

    if (schema.description) {
      baseItems.push({
        keyword: schemaKeywords.describe,
        args: schema.description,
      })
    }

    if (schema.pattern) {
      baseItems.unshift({
        keyword: schemaKeywords.matches,
        args: schema.pattern,
      })
    }

    if (max !== undefined) {
      baseItems.unshift({ keyword: schemaKeywords.max, args: max })
    }

    if (min !== undefined) {
      baseItems.unshift({ keyword: schemaKeywords.min, args: min })
    }

    if (nullable) {
      baseItems.push({ keyword: schemaKeywords.nullable })
    }

    if (schema.type && Array.isArray(schema.type)) {
      const [_schema, nullable] = schema.type

      if (nullable === 'null') {
        baseItems.push({ keyword: schemaKeywords.nullable })
      }
    }

    if (schema.readOnly) {
      baseItems.push({ keyword: schemaKeywords.readOnly })
    }

    if (isReference(schema)) {
      return [...this.#getRefAlias(schema, baseName), ...baseItems]
    }

    if (schema.oneOf) {
      // union
      const schemaWithoutOneOf = { ...schema, oneOf: undefined }

      const union: Schema = {
        keyword: schemaKeywords.union,
        args: schema.oneOf
          .map((item) => {
            return item && this.buildSchemas(item as SchemaObject, baseName)[0]
          })
          .filter(Boolean)
          .filter((item) => {
            return item && item.keyword !== unknownReturn
          }),
      }
      if (schemaWithoutOneOf.properties) {
        return [...this.buildSchemas(schemaWithoutOneOf, baseName), union, ...baseItems]
      }

      return [union, ...baseItems]
    }

    if (schema.anyOf) {
      // union
      const schemaWithoutAnyOf = { ...schema, anyOf: undefined }

      const union: Schema = {
        keyword: schemaKeywords.union,
        args: schema.anyOf
          .map((item) => {
            return item && this.buildSchemas(item as SchemaObject, baseName)[0]
          })
          .filter(Boolean)
          .filter((item) => {
            return item && item.keyword !== unknownReturn
          })
          .map((item) => {
            if (isKeyword(item, schemaKeywords.object)) {
              return {
                ...item,
                args: {
                  ...item.args,
                  strict: true,
                },
              }
            }
            return item
          }),
      }
      if (schemaWithoutAnyOf.properties) {
        return [...this.buildSchemas(schemaWithoutAnyOf, baseName), union, ...baseItems]
      }

      return [union, ...baseItems]
    }
    if (schema.allOf) {
      // intersection/add
      const schemaWithoutAllOf = { ...schema, allOf: undefined }

      const and: Schema = {
        keyword: schemaKeywords.and,
        args: schema.allOf
          .map((item) => {
            return item && this.buildSchemas(item as SchemaObject, baseName)[0]
          })
          .filter(Boolean)
          .filter((item) => {
            return item && item.keyword !== unknownReturn
          }),
      }

      if (schemaWithoutAllOf.properties) {
        return [
          {
            ...and,
            args: [...(and.args || []), ...this.buildSchemas(schemaWithoutAllOf, baseName)],
          },
          ...baseItems,
        ]
      }

      return [and, ...baseItems]
    }

    if (schema.enum) {
      const name = getUniqueName(pascalCase([baseName, options.enumSuffix].join(' ')), this.#getUsedEnumNames(_schema, baseName))
      const typeName = this.context.pluginManager.resolveName({
        name,
        pluginKey: this.context.plugin.key,
        type: 'type',
      })

      // x-enumNames has priority
      const extensionEnums = ['x-enumNames', 'x-enum-varnames']
        .filter((extensionKey) => extensionKey in schema)
        .map((extensionKey) => {
          return [
            {
              keyword: schemaKeywords.enum,
              args: {
                name,
                typeName,
                asConst: false,
                items: [...new Set(schema[extensionKey as keyof typeof schema] as string[])].map((name: string | number, index) => ({
                  name: transformers.stringify(name),
                  value: schema.enum?.[index] as string | number,
                  format: isNumber(schema.enum?.[index]) ? 'number' : 'string',
                })),
              },
            },
            ...baseItems.filter(
              (item) => item.keyword !== schemaKeywords.min && item.keyword !== schemaKeywords.max && item.keyword !== schemaKeywords.matches,
            ),
          ]
        })

      if (schema.type === 'number' || schema.type === 'integer') {
        // we cannot use z.enum when enum type is number/integer
        const enumNames = extensionEnums[0]?.find((item) => isKeyword(item, schemaKeywords.enum)) as SchemaKeywordMapper['enum']
        return [
          {
            keyword: schemaKeywords.enum,
            args: {
              name,
              typeName,
              asConst: true,
              items: enumNames?.args?.items
                ? [...new Set(enumNames.args.items)].map(({ name, value }) => ({
                    name,
                    value,
                    format: 'number',
                  }))
                : [...new Set(schema.enum)].map((value: string) => {
                    return {
                      name: value,
                      value,
                      format: 'number',
                    }
                  }),
            },
          },
          ...baseItems.filter((item) => item.keyword !== schemaKeywords.min && item.keyword !== schemaKeywords.max && item.keyword !== schemaKeywords.matches),
        ]
      }

      if (extensionEnums.length > 0 && extensionEnums[0]) {
        return extensionEnums[0]
      }

      return [
        {
          keyword: schemaKeywords.enum,
          args: {
            name,
            typeName,
            asConst: false,
            items: [...new Set(schema.enum)].map((value: string) => ({
              name: transformers.stringify(value),
              value,
              format: isNumber(value) ? 'number' : 'string',
            })),
          },
        },
        ...baseItems.filter((item) => item.keyword !== schemaKeywords.min && item.keyword !== schemaKeywords.max && item.keyword !== schemaKeywords.matches),
      ]
    }

    if ('prefixItems' in schema) {
      const prefixItems = schema.prefixItems as SchemaObject[]

      return [
        {
          keyword: schemaKeywords.tuple,
          args: prefixItems
            .map((item) => {
              return this.buildSchemas(item, baseName)[0]
            })
            .filter(Boolean),
        },
        ...baseItems,
      ]
    }

    if (version === '3.1' && 'const' in schema) {
      // const keyword takes precendence over the actual type.
      if (schema['const']) {
        return [
          {
            keyword: schemaKeywords.const,
            args: {
              name: schema['const'],
              format: typeof schema['const'] === 'number' ? 'number' : 'string',
              value: schema['const'],
            },
          },
          ...baseItems,
        ]
      }
      return [{ keyword: schemaKeywords.null }]
    }

    /**
     * > Structural validation alone may be insufficient to allow an application to correctly utilize certain values. The "format"
     * > annotation keyword is defined to allow schema authors to convey semantic information for a fixed subset of values which are
     * > accurately described by authoritative resources, be they RFCs or other external specifications.
     *
     * In other words: format is more specific than type alone, hence it should override the type value, if possible.
     *
     * see also https://json-schema.org/draft/2020-12/draft-bhutton-json-schema-validation-00#rfc.section.7
     */
    if (schema.format) {
      switch (schema.format) {
        case 'binary':
          baseItems.push({ keyword: schemaKeywords.blob })
          return baseItems
        case 'date-time':
          if (options.dateType) {
            if (options.dateType === 'date') {
              baseItems.unshift({ keyword: schemaKeywords.date, args: { type: 'date' } })

              return baseItems
            }

            if (options.dateType === 'stringOffset') {
              baseItems.unshift({ keyword: schemaKeywords.datetime, args: { offset: true } })
              return baseItems
            }

            if (options.dateType === 'stringLocal') {
              baseItems.unshift({ keyword: schemaKeywords.datetime, args: { local: true } })
              return baseItems
            }

            baseItems.unshift({ keyword: schemaKeywords.datetime, args: { offset: false } })

            return baseItems
          }
          break
        case 'date':
          if (options.dateType) {
            if (options.dateType === 'date') {
              baseItems.unshift({ keyword: schemaKeywords.date, args: { type: 'date' } })

              return baseItems
            }

            baseItems.unshift({ keyword: schemaKeywords.date, args: { type: 'string' } })

            return baseItems
          }
          break
        case 'time':
          if (options.dateType) {
            if (options.dateType === 'date') {
              baseItems.unshift({ keyword: schemaKeywords.time, args: { type: 'date' } })

              return baseItems
            }

            baseItems.unshift({ keyword: schemaKeywords.time, args: { type: 'string' } })

            return baseItems
          }
          break
        case 'uuid':
          baseItems.unshift({ keyword: schemaKeywords.uuid })
          break
        case 'email':
        case 'idn-email':
          baseItems.unshift({ keyword: schemaKeywords.email })
          break
        case 'uri':
        case 'ipv4':
        case 'ipv6':
        case 'uri-reference':
        case 'hostname':
        case 'idn-hostname':
          baseItems.unshift({ keyword: schemaKeywords.url })
          break
        // case 'duration':
        // case 'json-pointer':
        // case 'relative-json-pointer':
        default:
          // formats not yet implemented: ignore.
          break
      }
    }

    // type based logic
    if ('items' in schema || schema.type === ('array' as 'string')) {
      const min = schema.minimum ?? schema.minLength ?? schema.minItems ?? undefined
      const max = schema.maximum ?? schema.maxLength ?? schema.maxItems ?? undefined
      const items = this.buildSchemas('items' in schema ? (schema.items as SchemaObject) : [], baseName)

      return [
        {
          keyword: schemaKeywords.array,
          args: {
            items,
            min,
            max,
          },
        },
        ...baseItems.filter((item) => item.keyword !== schemaKeywords.min && item.keyword !== schemaKeywords.max),
      ]
    }

    if (schema.properties || schema.additionalProperties) {
      return [...this.#parseProperties(schema, baseName), ...baseItems]
    }

    if (schema.type) {
      if (Array.isArray(schema.type)) {
        // OPENAPI v3.1.0: https://www.openapis.org/blog/2021/02/16/migrating-from-openapi-3-0-to-3-1-0
        const [type] = schema.type as Array<OpenAPIV3.NonArraySchemaObjectType>

        return [
          ...this.buildSchemas(
            {
              ...schema,
              type,
            },
            baseName,
          ),
          ...baseItems,
        ].filter(Boolean)
      }

      // 'string' | 'number' | 'integer' | 'boolean'
      return [{ keyword: schema.type }, ...baseItems]
    }

    return [{ keyword: unknownReturn }]
  }

  async build(): Promise<Array<KubbFile.File<TFileMeta>>> {
    const { oas, contentType, include } = this.context

    const schemas = getSchemas({ oas, contentType, includes: include })

    const promises = Object.entries(schemas).reduce((acc, [name, schema]) => {
      const promiseOperation = this.schema.call(this, name, schema)

      if (promiseOperation) {
        acc.push(promiseOperation)
      }

      return acc
    }, [] as SchemaMethodResult<TFileMeta>[])

    const files = await Promise.all(promises)

    // using .flat because schemaGenerator[method] can return a array of files or just one file
    return files.flat().filter(Boolean)
  }

  /**
   * Schema
   */
  abstract schema(name: string, object: SchemaObject): SchemaMethodResult<TFileMeta>
  /**
   * Returns the source, in the future it an return a react component
   */
  abstract getSource<TOptions extends SchemaGeneratorBuildOptions = SchemaGeneratorBuildOptions>(name: string, schemas: Schema[], options?: TOptions): string[]

  /**
   * @deprecated only used for testing
   */
  abstract buildSource(name: string, object: SchemaObject | undefined, options?: SchemaGeneratorBuildOptions): string[]
}
