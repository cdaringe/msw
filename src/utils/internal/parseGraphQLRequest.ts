import { OperationDefinitionNode, OperationTypeNode, parse } from 'graphql'
import { GraphQLVariablesType } from '../../handlers/GraphQLHandler'
import { MockedRequest } from '../../handlers/RequestHandler'
import { getPublicUrlFromRequest } from '../request/getPublicUrlFromRequest'
import { jsonParse } from './jsonParse'

interface GraphQLInput {
  query: string | null
  variables?: GraphQLVariablesType
}

export interface ParsedGraphQLQuery {
  operationType: OperationTypeNode
  operationName?: string
}

export type ParsedGraphQLRequest<
  VariablesType extends GraphQLVariablesType = GraphQLVariablesType
> =
  | (ParsedGraphQLQuery & {
      variables?: VariablesType
    })
  | undefined

function parseQuery(query: string): ParsedGraphQLQuery | Error {
  try {
    const ast = parse(query)

    const operationDef = ast.definitions.find((def) => {
      return def.kind === 'OperationDefinition'
    }) as OperationDefinitionNode

    return {
      operationType: operationDef?.operation,
      operationName: operationDef?.name?.value,
    }
  } catch (error) {
    return error
  }
}

export type GraphQLParsedOperationsMap = Record<string, string[]>
export type GraphQLMultipartRequestBody = {
  operations: string
  map?: string
} & {
  [fileName: string]: File
}

function extractMultipartVariables<VariablesType extends GraphQLVariablesType>(
  variables: VariablesType,
  map: GraphQLParsedOperationsMap,
  files: Record<string, File>,
) {
  const operations = { variables }
  for (const [key, pathArray] of Object.entries(map)) {
    if (!(key in files)) {
      throw new Error(`Given files do not have a key '${key}' .`)
    }

    for (const dotPath of pathArray) {
      const [lastPath, ...reversedPaths] = dotPath.split('.').reverse()
      const paths = reversedPaths.reverse()
      let target: Record<string, any> = operations

      for (const path of paths) {
        if (!(path in target)) {
          throw new Error(`Property '${paths}' is not in operations.`)
        }

        target = target[path]
      }

      target[lastPath] = files[key]
    }
  }
  return operations.variables
}

function getGraphQLInput(request: MockedRequest<any>): GraphQLInput | null {
  switch (request.method) {
    case 'GET': {
      const query = request.url.searchParams.get('query')
      const variables = request.url.searchParams.get('variables') || ''

      return {
        query,
        variables: jsonParse(variables),
      }
    }

    case 'POST': {
      if (request.body?.query) {
        const { query, variables } = request.body

        return {
          query,
          variables,
        }
      }

      // Handle multipart body operations.
      if (request.body?.operations) {
        const {
          operations,
          map,
          ...files
        } = request.body as GraphQLMultipartRequestBody
        const parsedOperations =
          jsonParse<{ query?: string; variables?: GraphQLVariablesType }>(
            operations,
          ) || {}

        if (!parsedOperations.query) {
          return null
        }

        const parsedMap = jsonParse<GraphQLParsedOperationsMap>(map || '') || {}
        const variables = parsedOperations.variables
          ? extractMultipartVariables(
              parsedOperations.variables,
              parsedMap,
              files,
            )
          : {}

        return {
          query: parsedOperations.query,
          variables,
        }
      }
    }

    default:
      return null
  }
}

/**
 * Determines if a given request can be considered a GraphQL request.
 * Does not parse the query and does not guarantee its validity.
 */
export function parseGraphQLRequest(
  request: MockedRequest<any>,
): ParsedGraphQLRequest | null {
  const input = getGraphQLInput(request)

  if (!input || !input.query) {
    return null
  }

  const { query, variables } = input
  const parsedResult = parseQuery(query)

  if (parsedResult instanceof Error) {
    const requestPublicUrl = getPublicUrlFromRequest(request)

    // Encountered a matching GraphQL request that is syntactically invalid.
    // We may consider getting the parsing error and propagating it to the user.
    console.error(
      `[MSW] Failed to intercept a GraphQL request to "${request.method} ${requestPublicUrl}": cannot parse query. See the error message from the parser below.`,
    )
    console.error(parsedResult)
    return null
  }

  return {
    operationType: parsedResult.operationType,
    operationName: parsedResult.operationName,
    variables,
  }
}
