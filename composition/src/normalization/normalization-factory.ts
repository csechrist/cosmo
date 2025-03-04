import {
  ConstDirectiveNode,
  DefinitionNode,
  DirectiveDefinitionNode,
  DirectiveNode,
  DocumentNode,
  FieldDefinitionNode,
  GraphQLSchema,
  InterfaceTypeDefinitionNode,
  InterfaceTypeExtensionNode,
  Kind,
  ListValueNode,
  ObjectTypeDefinitionNode,
  ObjectTypeExtensionNode,
  OperationTypeDefinitionNode,
  OperationTypeNode,
  print,
  StringValueNode,
  TypeNode,
} from 'graphql';
import {
  areBaseAndExtensionKindsCompatible,
  EnumTypeNode,
  extractExecutableDirectiveLocations,
  extractInterfaces,
  InterfaceTypeNode,
  isNodeInterfaceObject,
  isObjectLikeNodeEntity,
  ObjectTypeNode,
  operationTypeNodeToDefaultType,
  safeParse,
  ScalarTypeNode,
} from '../ast/utils';
import {
  addNonExternalFieldsToSet,
  FieldSetData,
  InputValidationContainer,
  isNodeQuery,
  newFieldSetData,
  validateAndAddDirectivesWithFieldSetToConfigurationData,
} from './utils';
import {
  BASE_DIRECTIVE_DEFINITION_BY_DIRECTIVE_NAME,
  BASE_DIRECTIVE_DEFINITIONS,
  BASE_SCALARS,
  FIELD_SET_SCALAR_DEFINITION,
  SCOPE_SCALAR_DEFINITION,
  VERSION_TWO_DIRECTIVE_DEFINITIONS,
} from '../utils/constants';
import {
  addIterableValuesToSet,
  AuthorizationData,
  EntityData,
  EntityDataByTypeName,
  EntityInterfaceSubgraphData,
  FieldAuthorizationData,
  getAuthorizationDataToUpdate,
  getOrThrowError,
  getValueOrDefault,
  ImplementationErrors,
  InvalidArgument,
  InvalidFieldImplementation,
  isNodeKindInterface,
  kindToTypeString,
  maxOrScopes,
  mergeAuthorizationDataByAND,
  newAuthorizationData,
  resetAuthorizationData,
  setAndGetValue,
  subtractSourceSetFromTargetSet,
  upsertAuthorizationData,
  upsertEntityData,
  upsertEntityDataProperties,
  upsertFieldAuthorizationData,
} from '../utils/utils';
import {
  duplicateEnumValueDefinitionError,
  duplicateFieldDefinitionError,
  duplicateInterfaceExtensionError,
  duplicateOverriddenFieldErrorMessage,
  duplicateOverriddenFieldsError,
  equivalentSourceAndTargetOverrideErrorMessage,
  expectedEntityError,
  incompatibleExtensionError,
  incompatibleExtensionKindsError,
  incompatibleParentKindFatalError,
  invalidArgumentsError,
  invalidDirectiveArgumentTypeErrorMessage,
  invalidDirectiveError,
  invalidEventDrivenGraphError,
  invalidEventsDrivenMutationResponseTypeErrorMessage,
  invalidKeyDirectiveArgumentErrorMessage,
  invalidKeyDirectivesError,
  invalidKeyFieldSetsEventDrivenErrorMessage,
  invalidPublishEventResultObjectErrorMessage,
  invalidRootTypeDefinitionError,
  invalidRootTypeFieldEventsDirectivesErrorMessage,
  invalidRootTypeFieldResponseTypesEventDrivenErrorMessage,
  invalidSubgraphNameErrorMessage,
  invalidSubgraphNamesError,
  noBaseTypeExtensionError,
  noFieldDefinitionsError,
  nonEntityObjectExtensionsEventDrivenErrorMessage,
  nonExternalKeyFieldNamesEventDrivenErrorMessage,
  nonKeyComposingObjectTypeNamesEventDrivenErrorMessage,
  nonKeyFieldNamesEventDrivenErrorMessage,
  operationDefinitionError,
  orScopesLimitError,
  subgraphInvalidSyntaxError,
  subgraphValidationError,
  subgraphValidationFailureError,
  undefinedObjectLikeParentError,
  undefinedRequiredArgumentsErrorMessage,
  undefinedTypeError,
  unexpectedDirectiveArgumentErrorMessage,
  unexpectedKindFatalError,
  unimplementedInterfaceFieldsError,
} from '../errors/errors';
import {
  AUTHENTICATED,
  DEFAULT,
  ENTITIES_FIELD,
  EVENT_DIRECTIVE_NAMES,
  EVENTS_PUBLISH,
  EVENTS_REQUEST,
  EVENTS_SUBSCRIBE,
  EXTENDS,
  EXTERNAL,
  FIELDS,
  FROM,
  KEY,
  MUTATION,
  N_A,
  NON_NULLABLE_BOOLEAN,
  NON_NULLABLE_PUBLISH_EVENT_RESULT,
  OPERATION_TO_DEFAULT,
  OVERRIDE,
  PARENTS,
  PUBLISH_EVENT_RESULT,
  QUERY,
  REQUIRES_SCOPES,
  RESOLVABLE,
  SCHEMA,
  SCOPES,
  SERVICE_FIELD,
  SOURCE_NAME,
  SUBSCRIPTION,
  SUCCESS,
  TOPIC,
} from '../utils/string-constants';
import { buildASTSchema } from '../buildASTSchema/buildASTSchema';
import { ConfigurationData, EventConfiguration, EventType } from '../router-configuration/router-configuration';
import { printTypeNode } from '@graphql-tools/merge';
import { InternalSubgraph, recordSubgraphName, Subgraph } from '../subgraph/subgraph';
import { invalidOverrideTargetSubgraphNameWarning } from '../warnings/warnings';
import {
  consolidateAuthorizationDirectives,
  upsertDirectiveAndSchemaDefinitions,
  upsertParentsAndChildren,
} from './walkers';
import {
  FieldData,
  ParentDefinitionData,
  ParentWithFieldsData,
  PersistedDirectiveDefinitionData,
  SchemaData,
} from '../schema-building/type-definition-data';
import {
  EnumExtensionData,
  ExtensionWithFieldsData,
  InputObjectExtensionData,
  ObjectExtensionData,
  ParentExtensionData,
  ScalarExtensionData,
  UnionExtensionData,
} from '../schema-building/type-extension-data';
import {
  addExtensionWithFieldsDataByNode,
  addPersistedDirectiveDefinitionDataByNode,
  convertKindForExtension,
  extractDirectives,
  getDirectiveValidationErrors,
  getEnumNodeByData,
  getInputObjectNodeByData,
  getParentWithFieldsNodeByData,
  getScalarNodeByData,
  getSchemaNodeByData,
  getUnionNodeByData,
  isTypeValidImplementation,
  ObjectData,
} from '../schema-building/utils';
import { MultiGraph } from 'graphology';
import { getTypeNodeNamedTypeName, ObjectLikeTypeNode } from '../schema-building/ast';
import { InvalidRootTypeFieldEventsDirectiveData } from '../errors/utils';

export type NormalizationResult = {
  authorizationDataByParentTypeName: Map<string, AuthorizationData>;
  concreteTypeNamesByAbstractTypeName: Map<string, Set<string>>;
  configurationDataByParentTypeName: Map<string, ConfigurationData>;
  entityInterfaces: Map<string, EntityInterfaceSubgraphData>;
  entityContainerByTypeName: EntityDataByTypeName;
  parentDefinitionDataByTypeName: Map<string, ParentDefinitionData>;
  parentExtensionDataByTypeName: Map<string, ObjectExtensionData>;
  originalTypeNameByRenamedTypeName: Map<string, string>;
  isVersionTwo: boolean;
  keyFieldNamesByParentTypeName: Map<string, Set<string>>;
  operationTypes: Map<string, OperationTypeNode>;
  overridesByTargetSubgraphName: Map<string, Map<string, Set<string>>>;
  parentDataByTypeName: Map<string, ParentDefinitionData>;
  persistedDirectiveDefinitionDataByDirectiveName: Map<string, PersistedDirectiveDefinitionData>;
  schema: GraphQLSchema;
  subgraphAST: DocumentNode;
  subgraphString: string;
};

export type NormalizationResultContainer = {
  errors?: Error[];
  normalizationResult?: NormalizationResult;
};

export type BatchNormalizationContainer = {
  authorizationDataByParentTypeName: Map<string, AuthorizationData>;
  concreteTypeNamesByAbstractTypeName: Map<string, Set<string>>;
  entityContainerByTypeName: EntityDataByTypeName;
  graph: MultiGraph;
  internalSubgraphBySubgraphName: Map<string, InternalSubgraph>;
  errors?: Error[];
  warnings?: string[];
};

export function normalizeSubgraphFromString(subgraphSDL: string): NormalizationResultContainer {
  const { error, documentNode } = safeParse(subgraphSDL);
  if (error || !documentNode) {
    return { errors: [subgraphInvalidSyntaxError(error)] };
  }
  const normalizationFactory = new NormalizationFactory(new MultiGraph());
  return normalizationFactory.normalize(documentNode);
}

export function normalizeSubgraph(
  document: DocumentNode,
  graph?: MultiGraph,
  subgraphName?: string,
): NormalizationResultContainer {
  const normalizationFactory = new NormalizationFactory(graph || new MultiGraph(), subgraphName);
  return normalizationFactory.normalize(document);
}

export class NormalizationFactory {
  argumentName = '';
  authorizationDataByParentTypeName = new Map<string, AuthorizationData>();
  childName = '';
  concreteTypeNamesByAbstractTypeName = new Map<string, Set<string>>();
  configurationDataByParentTypeName = new Map<string, ConfigurationData>();
  customDirectiveDefinitions = new Map<string, DirectiveDefinitionNode>();
  directiveDefinitionByDirectiveName = new Map<string, DirectiveDefinitionNode>();
  errors: Error[] = [];
  entityDataByTypeName = new Map<string, EntityData>();
  entityInterfaces = new Map<string, EntityInterfaceSubgraphData>();
  graph: MultiGraph;
  parentExtensionDataByTypeName = new Map<string, ParentExtensionData>();
  interfaceTypeNamesWithAuthorizationDirectives = new Set<string>();
  isCurrentParentExtension = false;
  isEventDrivenSubgraph = false;
  isSubgraphVersionTwo = false;
  fieldSetDataByTypeName = new Map<string, FieldSetData>();
  heirFieldAuthorizationDataByTypeName = new Map<string, FieldAuthorizationData[]>();
  handledRepeatedDirectivesByHostPath = new Map<string, Set<string>>();
  lastParentNodeKind: Kind = Kind.NULL;
  lastChildNodeKind: Kind = Kind.NULL;
  leafTypeNamesWithAuthorizationDirectives = new Set<string>();
  keyFieldNamesByParentTypeName = new Map<string, Set<string>>();
  operationTypeNodeByTypeName = new Map<string, OperationTypeNode>();
  originalTypeNameByRenamedTypeName = new Map<string, string>();
  parentDefinitionDataByTypeName = new Map<string, ParentDefinitionData>();
  originalParentTypeName = '';
  parentsWithChildArguments = new Set<string>();
  eventsConfigurations = new Map<string, EventConfiguration[]>();
  overridesByTargetSubgraphName = new Map<string, Map<string, Set<string>>>();
  invalidOrScopesHostPaths = new Set<string>();
  schemaDefinition: SchemaData;
  referencedDirectiveNames = new Set<string>();
  referencedTypeNames = new Set<string>();
  renamedParentTypeName = '';
  warnings: string[] = [];
  subgraphName: string;

  constructor(graph: MultiGraph, subgraphName?: string) {
    for (const [baseDirectiveName, baseDirectiveDefinition] of BASE_DIRECTIVE_DEFINITION_BY_DIRECTIVE_NAME) {
      this.directiveDefinitionByDirectiveName.set(baseDirectiveName, baseDirectiveDefinition);
    }
    this.graph = graph;
    this.subgraphName = subgraphName || N_A;
    this.schemaDefinition = {
      directivesByDirectiveName: new Map<string, ConstDirectiveNode[]>(),
      kind: Kind.SCHEMA_DEFINITION,
      typeName: SCHEMA,
      operationTypes: new Map<OperationTypeNode, OperationTypeDefinitionNode>(),
    };
  }

  validateInputNamedType(namedType: string): InputValidationContainer {
    if (BASE_SCALARS.has(namedType)) {
      return { hasUnhandledError: false, typeString: '' };
    }
    const parentContainer = this.parentDefinitionDataByTypeName.get(namedType);
    if (!parentContainer) {
      this.errors.push(undefinedTypeError(namedType));
      return { hasUnhandledError: false, typeString: '' };
    }
    switch (parentContainer.kind) {
      case Kind.ENUM_TYPE_DEFINITION:
      case Kind.INPUT_OBJECT_TYPE_DEFINITION:
      case Kind.SCALAR_TYPE_DEFINITION:
        return { hasUnhandledError: false, typeString: '' };
      default:
        return { hasUnhandledError: true, typeString: kindToTypeString(parentContainer.kind) };
    }
  }

  validateArguments(fieldData: FieldData, fieldPath: string) {
    const invalidArguments: InvalidArgument[] = [];
    for (const [argumentName, argumentNode] of fieldData.argumentDataByArgumentName) {
      const namedTypeName = getTypeNodeNamedTypeName(argumentNode.type);
      const { hasUnhandledError, typeString } = this.validateInputNamedType(namedTypeName);
      if (hasUnhandledError) {
        invalidArguments.push({
          argumentName,
          namedType: namedTypeName,
          typeString,
          typeName: printTypeNode(argumentNode.type),
        });
      }
    }
    if (invalidArguments.length > 0) {
      this.errors.push(invalidArgumentsError(fieldPath, invalidArguments));
    }
  }

  // Note that directive validation errors are handled elsewhere
  getAuthorizationData(node: InterfaceTypeNode | ObjectTypeNode): AuthorizationData | undefined {
    const parentTypeName = this.renamedParentTypeName || this.originalParentTypeName;
    let authorizationData = this.authorizationDataByParentTypeName.get(parentTypeName);
    resetAuthorizationData(authorizationData);
    if (!node.directives) {
      return authorizationData;
    }
    let requiresAuthentication = false;
    const requiresScopes: ConstDirectiveNode[] = [];
    for (const directiveNode of node.directives) {
      const directiveName = directiveNode.name.value;
      if (directiveName === AUTHENTICATED) {
        // @authenticated is not repeatable
        if (requiresAuthentication) {
          return;
        }
        requiresAuthentication = true;
        continue;
      }
      if (directiveName !== REQUIRES_SCOPES) {
        continue;
      }
      // @requiresScopes is not repeatable
      if (requiresScopes.length > 0) {
        return;
      }
      requiresScopes.push(directiveNode);
    }
    if (!requiresAuthentication && requiresScopes.length < 1) {
      return authorizationData;
    }
    if (isNodeKindInterface(node.kind)) {
      this.interfaceTypeNamesWithAuthorizationDirectives.add(parentTypeName);
    }
    if (!authorizationData) {
      authorizationData = setAndGetValue(
        this.authorizationDataByParentTypeName,
        this.renamedParentTypeName || this.originalParentTypeName,
        newAuthorizationData(parentTypeName),
      );
    }
    authorizationData.hasParentLevelAuthorization = true;
    authorizationData.requiresAuthentication = requiresAuthentication;
    if (requiresScopes.length !== 1) {
      return authorizationData;
    }
    const directiveNode = requiresScopes[0];
    if (!directiveNode.arguments || directiveNode.arguments.length !== 1) {
      return;
    }
    const scopesArgument = directiveNode.arguments[0];
    if (scopesArgument.name.value !== SCOPES || scopesArgument.value.kind !== Kind.LIST) {
      return;
    }
    const orScopes = scopesArgument.value.values;
    if (orScopes.length < 1) {
      return authorizationData;
    }
    if (orScopes.length > maxOrScopes) {
      this.invalidOrScopesHostPaths.add(this.originalParentTypeName);
      return;
    }
    for (const scopes of orScopes) {
      if (scopes.kind !== Kind.LIST) {
        return;
      }
      const andScopes = new Set<string>();
      for (const scope of scopes.values) {
        if (scope.kind !== Kind.STRING) {
          return;
        }
        andScopes.add(scope.value);
      }
      if (andScopes.size) {
        authorizationData.requiredScopes.push(andScopes);
      }
    }
    return authorizationData;
  }

  extractDirectivesAndAuthorization(
    node: EnumTypeNode | FieldDefinitionNode | ScalarTypeNode,
    directivesByDirectiveName: Map<string, ConstDirectiveNode[]>,
  ): Map<string, ConstDirectiveNode[]> {
    if (!node.directives) {
      return directivesByDirectiveName;
    }
    const hostPath = this.childName ? `${this.originalParentTypeName}.${this.childName}` : this.originalParentTypeName;
    const authorizationDirectives: ConstDirectiveNode[] = [];
    for (const directiveNode of node.directives) {
      const errorMessages = getDirectiveValidationErrors(
        directiveNode,
        node.kind,
        directivesByDirectiveName,
        this.directiveDefinitionByDirectiveName,
        this.handledRepeatedDirectivesByHostPath,
        hostPath,
      );
      const directiveName = directiveNode.name.value;
      if (errorMessages.length > 0) {
        this.errors.push(invalidDirectiveError(directiveName, hostPath, errorMessages));
        continue;
      }
      if (directiveName === EXTENDS) {
        continue;
      }
      if (directiveName === OVERRIDE) {
        this.handleOverrideDeclaration(directiveNode, hostPath, errorMessages);
        if (errorMessages.length > 0) {
          this.errors.push(invalidDirectiveError(directiveName, hostPath, errorMessages));
        }
        continue;
      }
      if (directiveName === AUTHENTICATED || directiveName === REQUIRES_SCOPES) {
        authorizationDirectives.push(directiveNode);
        continue;
      }
      const existingDirectives = directivesByDirectiveName.get(directiveName);
      if (existingDirectives) {
        existingDirectives.push(directiveNode);
      }
      directivesByDirectiveName.set(directiveName, [directiveNode]);
    }
    if (authorizationDirectives.length < 1) {
      return directivesByDirectiveName;
    }
    const parentTypeName = this.renamedParentTypeName || this.originalParentTypeName;
    if (node.kind !== Kind.FIELD_DEFINITION) {
      this.leafTypeNamesWithAuthorizationDirectives.add(parentTypeName);
    }
    const parentAuthorizationData = getValueOrDefault(this.authorizationDataByParentTypeName, parentTypeName, () =>
      newAuthorizationData(parentTypeName),
    );
    const authorizationData = getAuthorizationDataToUpdate(parentAuthorizationData, node, this.childName);
    for (const directiveNode of authorizationDirectives) {
      const directiveName = directiveNode.name.value;
      if (directiveName === AUTHENTICATED) {
        authorizationData.requiresAuthentication = true;
        continue;
      }
      const orScopes = (directiveNode.arguments![0].value as ListValueNode).values;
      if (orScopes.length > maxOrScopes) {
        this.invalidOrScopesHostPaths.add(hostPath);
        continue;
      }
      for (const scopes of orScopes) {
        const andScopes = new Set<string>();
        for (const scope of (scopes as ListValueNode).values) {
          andScopes.add((scope as StringValueNode).value);
        }
        if (andScopes.size) {
          authorizationData.requiredScopes.push(andScopes);
        }
      }
    }
    return directivesByDirectiveName;
  }

  mergeUniqueInterfaces(extensionInterfaces: Set<string>, interfaces: Set<string>, typeName: string) {
    for (const interfaceName of extensionInterfaces) {
      if (!interfaces.has(interfaceName)) {
        interfaces.add(interfaceName);
        continue;
      }
      this.errors.push(duplicateInterfaceExtensionError(interfaceName, typeName));
    }
  }

  handleInterfaceObject(node: ObjectTypeDefinitionNode) {
    if (!isNodeInterfaceObject(node)) {
      return;
    }
    const name = node.name.value;
    if (this.entityInterfaces.has(name)) {
      // TODO error
      return;
    }
    this.entityInterfaces.set(name, {
      interfaceObjectFieldNames: new Set<string>(node.fields?.map((field) => field.name.value)),
      interfaceFieldNames: new Set<string>(),
      isInterfaceObject: true,
      typeName: name,
    });
  }

  handleExtensionWithFields(
    node: InterfaceTypeDefinitionNode | InterfaceTypeExtensionNode | ObjectTypeDefinitionNode | ObjectTypeExtensionNode,
    isRootType = false,
  ): false | void {
    this.isCurrentParentExtension = true;
    const parentExtensionData = this.parentExtensionDataByTypeName.get(this.originalParentTypeName);
    const convertedKind = convertKindForExtension(node);
    if (parentExtensionData) {
      if (parentExtensionData.kind !== convertedKind) {
        this.errors.push(incompatibleExtensionKindsError(node, parentExtensionData.kind));
        return false;
      }
      extractDirectives(
        node,
        parentExtensionData.directivesByDirectiveName,
        this.errors,
        this.directiveDefinitionByDirectiveName,
        this.handledRepeatedDirectivesByHostPath,
        this.originalParentTypeName,
      );
      extractInterfaces(node, parentExtensionData.implementedInterfaceTypeNames, this.errors);
      return;
    }
    const isEntity = isObjectLikeNodeEntity(node);
    addExtensionWithFieldsDataByNode(
      this.parentExtensionDataByTypeName,
      node,
      this.errors,
      this.directiveDefinitionByDirectiveName,
      this.handledRepeatedDirectivesByHostPath,
      isEntity,
      isRootType,
      this.subgraphName,
      this.renamedParentTypeName,
    );
    // TODO re-assess this line
    if (node.kind === Kind.INTERFACE_TYPE_DEFINITION || node.kind === Kind.INTERFACE_TYPE_EXTENSION || !isEntity) {
      return;
    }
    const fieldSetData = getValueOrDefault(this.fieldSetDataByTypeName, this.originalParentTypeName, newFieldSetData);
    this.extractKeyFieldSets(node, fieldSetData);
    upsertEntityDataProperties(this.entityDataByTypeName, {
      typeName: this.originalParentTypeName,
      keyFieldSets: fieldSetData.isUnresolvableByKeyFieldSet.keys(),
      ...(this.subgraphName ? { subgraphNames: [this.subgraphName] } : {}),
    });
  }

  extractKeyFieldSets(node: ObjectLikeTypeNode, fieldSetData: FieldSetData) {
    const isUnresolvableByRawKeyFieldSet = fieldSetData.isUnresolvableByKeyFieldSet;
    const parentTypeName = node.name.value;
    if (!node.directives?.length) {
      // This should never happen
      this.errors.push(expectedEntityError(parentTypeName));
      return;
    }
    const errorMessages: string[] = [];
    for (const directive of node.directives) {
      if (directive.name.value !== KEY) {
        continue;
      }
      if (!directive.arguments || directive.arguments.length < 1) {
        errorMessages.push(undefinedRequiredArgumentsErrorMessage(KEY, parentTypeName, [FIELDS]));
        continue;
      }
      let keyFieldSet;
      let isUnresolvable = false;
      for (const arg of directive.arguments) {
        const argumentName = arg.name.value;
        if (arg.name.value === RESOLVABLE) {
          if (arg.value.kind === Kind.BOOLEAN && !arg.value.value) {
            isUnresolvable = true;
          }
          continue;
        }
        if (arg.name.value !== FIELDS) {
          keyFieldSet = undefined;
          errorMessages.push(unexpectedDirectiveArgumentErrorMessage(KEY, argumentName));
          break;
        }
        if (arg.value.kind !== Kind.STRING) {
          keyFieldSet = undefined;
          errorMessages.push(invalidKeyDirectiveArgumentErrorMessage(arg.value.kind));
          break;
        }
        keyFieldSet = arg.value.value;
      }
      if (keyFieldSet !== undefined) {
        isUnresolvableByRawKeyFieldSet.set(keyFieldSet, isUnresolvable);
      }
    }
    if (errorMessages.length) {
      this.errors.push(invalidKeyDirectivesError(parentTypeName, errorMessages));
    }
  }

  validateInterfaceImplementations(container: ParentWithFieldsData) {
    if (container.implementedInterfaceTypeNames.size < 1) {
      return;
    }
    const implementationErrorsMap = new Map<string, ImplementationErrors>();
    for (const interfaceName of container.implementedInterfaceTypeNames) {
      const interfaceContainer = getOrThrowError(this.parentDefinitionDataByTypeName, interfaceName, PARENTS);
      if (interfaceContainer.kind !== Kind.INTERFACE_TYPE_DEFINITION) {
        throw incompatibleParentKindFatalError(interfaceName, Kind.INTERFACE_TYPE_DEFINITION, interfaceContainer.kind);
      }
      const implementationErrors: ImplementationErrors = {
        invalidFieldImplementations: new Map<string, InvalidFieldImplementation>(),
        unimplementedFields: [],
      };
      let hasErrors = false;
      for (const [fieldName, interfaceField] of interfaceContainer.fieldDataByFieldName) {
        let hasNestedErrors = false;
        const containerField = container.fieldDataByFieldName.get(fieldName);
        if (!containerField) {
          hasErrors = true;
          implementationErrors.unimplementedFields.push(fieldName);
          continue;
        }
        const invalidFieldImplementation: InvalidFieldImplementation = {
          invalidAdditionalArguments: new Set<string>(),
          invalidImplementedArguments: [],
          originalResponseType: printTypeNode(interfaceField.node.type),
          unimplementedArguments: new Set<string>(),
        };
        // The implemented field type must be equally or more restrictive than the original interface field type
        if (
          !isTypeValidImplementation(
            interfaceField.node.type,
            containerField.node.type,
            this.concreteTypeNamesByAbstractTypeName,
          )
        ) {
          hasErrors = true;
          hasNestedErrors = true;
          invalidFieldImplementation.implementedResponseType = printTypeNode(containerField.node.type);
        }
        const handledArguments = new Set<string>();
        for (const [argumentName, interfaceArgument] of interfaceField.argumentDataByArgumentName) {
          handledArguments.add(argumentName);
          const containerArgument = containerField.argumentDataByArgumentName.get(argumentName);
          // The type implementing the interface must include all arguments with no variation for that argument
          if (!containerArgument) {
            hasErrors = true;
            hasNestedErrors = true;
            invalidFieldImplementation.unimplementedArguments.add(argumentName);
            continue;
          }
          // Implemented arguments should be the exact same type
          const actualType = printTypeNode(containerArgument.type as TypeNode);
          const expectedType = printTypeNode(interfaceArgument.type as TypeNode);
          if (expectedType !== actualType) {
            hasErrors = true;
            hasNestedErrors = true;
            invalidFieldImplementation.invalidImplementedArguments.push({ actualType, argumentName, expectedType });
          }
        }
        // Additional arguments must be optional (nullable)
        for (const [argumentName, argumentData] of containerField.argumentDataByArgumentName) {
          if (handledArguments.has(argumentName)) {
            continue;
          }
          if (argumentData.type.kind !== Kind.NON_NULL_TYPE) {
            continue;
          }
          hasErrors = true;
          hasNestedErrors = true;
          invalidFieldImplementation.invalidAdditionalArguments.add(argumentName);
        }
        if (hasNestedErrors) {
          implementationErrors.invalidFieldImplementations.set(fieldName, invalidFieldImplementation);
        }
      }
      if (hasErrors) {
        implementationErrorsMap.set(interfaceName, implementationErrors);
      }
    }
    if (implementationErrorsMap.size) {
      this.errors.push(
        unimplementedInterfaceFieldsError(container.name, kindToTypeString(container.kind), implementationErrorsMap),
      );
    }
  }

  handleOverrideDeclaration(node: DirectiveNode, hostPath: string, errorMessages: string[]) {
    const argumentNode = node.arguments![0];
    if (argumentNode.value.kind !== Kind.STRING) {
      errorMessages.push(invalidDirectiveArgumentTypeErrorMessage(true, FROM, Kind.STRING, argumentNode.value.kind));
      return;
    }
    const targetSubgraphName = argumentNode.value.value;
    if (targetSubgraphName === this.subgraphName) {
      errorMessages.push(equivalentSourceAndTargetOverrideErrorMessage(targetSubgraphName, hostPath));
      return;
    }
    const overrideDataForSubgraph = getValueOrDefault(
      this.overridesByTargetSubgraphName,
      targetSubgraphName,
      () => new Map<string, Set<string>>(),
    );
    const overriddenFieldNamesForParent = getValueOrDefault(
      overrideDataForSubgraph,
      this.renamedParentTypeName || this.originalParentTypeName,
      () => new Set<string>(),
    );
    overriddenFieldNamesForParent.add(this.childName);
  }

  extractEventDirectivesToConfiguration(node: FieldDefinitionNode) {
    if (!node.directives) {
      return;
    }
    for (const directive of node.directives) {
      let eventType: EventType;
      switch (directive.name.value) {
        case EVENTS_PUBLISH: {
          eventType = 'publish';
          break;
        }
        case EVENTS_REQUEST: {
          eventType = 'request';
          break;
        }
        case EVENTS_SUBSCRIBE: {
          eventType = 'subscribe';
          break;
        }
        default:
          continue;
      }
      let topic: string | undefined;
      let sourceName: string | undefined;
      for (const arg of directive.arguments || []) {
        if (arg.value.kind !== Kind.STRING) {
          throw new Error(`Event directive arguments must be strings, ${arg.value.kind} found in argument ${arg.name}`);
        }
        switch (arg.name.value) {
          case TOPIC: {
            if (topic !== undefined) {
              throw new Error(`Event directives must have exactly one topic argument, found multiple`);
            }
            if (!arg.value.value) {
              throw new Error(`Event directives must have a non-empty topic argument`);
            }
            topic = arg.value.value;
            break;
          }
          case SOURCE_NAME: {
            if (sourceName !== undefined) {
              throw new Error(`Event directives must have exactly one sourceID argument, found multiple`);
            }
            if (!arg.value.value) {
              throw new Error(`Event directives must have a non-empty sourceID argument`);
            }
            sourceName = arg.value.value;
            break;
          }
          default:
            throw new Error(`Unknown argument ${arg.name.value} found in event directive`);
        }
      }

      if (!topic) {
        throw new Error(`Event directives must have a topic argument`);
      }

      const configuration = getValueOrDefault(
        this.eventsConfigurations,
        this.renamedParentTypeName || this.originalParentTypeName,
        () => [],
      );
      configuration.push({
        type: eventType,
        fieldName: this.childName,
        topic,
        sourceName: sourceName || DEFAULT,
      });
    }
  }

  getValidEventsDirectiveNamesForRootTypeName(parentTypeName: string): Set<string> | undefined {
    const operationTypeNode = this.operationTypeNodeByTypeName.get(parentTypeName);
    if (!operationTypeNode) {
      switch (parentTypeName) {
        case MUTATION:
          return new Set<string>([EVENTS_PUBLISH, EVENTS_REQUEST]);
        case QUERY:
          return new Set<string>([EVENTS_REQUEST]);
        case SUBSCRIPTION:
          return new Set<string>([EVENTS_SUBSCRIBE]);
        default:
          return;
      }
    }
    switch (operationTypeNode) {
      case OperationTypeNode.MUTATION:
        return new Set<string>([EVENTS_REQUEST, EVENTS_PUBLISH]);
      case OperationTypeNode.QUERY:
        return new Set<string>([EVENTS_REQUEST]);
      case OperationTypeNode.SUBSCRIPTION:
        return new Set<string>([EVENTS_SUBSCRIBE]);
      default:
        return;
    }
  }

  validateEventDrivenRootType(
    data: ObjectData,
    validEventsDirectiveNames: Set<string>,
    invalidEventsDirectiveDataByRootFieldPath: Map<string, InvalidRootTypeFieldEventsDirectiveData>,
    invalidResponseTypeStringByRootFieldPath: Map<string, string>,
    invalidResponseTypeNameByMutationPath: Map<string, string>,
  ) {
    const isMutation = validEventsDirectiveNames.has(EVENTS_PUBLISH);
    for (const [fieldName, fieldData] of data.fieldDataByFieldName) {
      const fieldPath = `${fieldData.originalParentTypeName}.${fieldName}`;
      const definedEventsDirectiveNames = new Set<string>();
      for (const eventsDirectiveName of EVENT_DIRECTIVE_NAMES) {
        if (fieldData.directivesByDirectiveName.has(eventsDirectiveName)) {
          definedEventsDirectiveNames.add(eventsDirectiveName);
        }
      }
      const invalidEventsDirectiveNames = new Set<string>();
      for (const definedEventsDirectiveName of definedEventsDirectiveNames) {
        if (!validEventsDirectiveNames.has(definedEventsDirectiveName)) {
          invalidEventsDirectiveNames.add(definedEventsDirectiveName);
        }
      }
      if (definedEventsDirectiveNames.size < 1 || invalidEventsDirectiveNames.size > 0) {
        invalidEventsDirectiveDataByRootFieldPath.set(fieldPath, {
          definesDirectives: definedEventsDirectiveNames.size > 0,
          invalidDirectiveNames: [...invalidEventsDirectiveNames],
        });
      }
      if (isMutation) {
        const typeString = printTypeNode(fieldData.type);
        if (typeString !== NON_NULLABLE_PUBLISH_EVENT_RESULT) {
          invalidResponseTypeNameByMutationPath.set(fieldPath, typeString);
        }
        continue;
      }
      const fieldTypeString = printTypeNode(fieldData.type);
      const expectedTypeString = fieldData.namedTypeName + '!';
      let isValid = false;
      const concreteTypeNames =
        this.concreteTypeNamesByAbstractTypeName.get(fieldData.namedTypeName) ||
        new Set<string>([fieldData.namedTypeName]);
      for (const concreteTypeName of concreteTypeNames) {
        isValid ||= this.entityDataByTypeName.has(concreteTypeName);
        if (isValid) {
          break;
        }
      }
      if (!isValid || fieldTypeString !== expectedTypeString) {
        invalidResponseTypeStringByRootFieldPath.set(fieldPath, fieldTypeString);
      }
    }
  }

  validateEventDrivenKeyDefinition(typeName: string, invalidKeyFieldSetsByEntityTypeName: Map<string, string[]>) {
    const fieldSetData = this.fieldSetDataByTypeName.get(typeName);
    if (!fieldSetData) {
      return;
    }
    for (const [keyFieldSet, isUnresolvable] of fieldSetData.isUnresolvableByKeyFieldSet) {
      if (isUnresolvable) {
        continue;
      }
      getValueOrDefault(invalidKeyFieldSetsByEntityTypeName, typeName, () => []).push(keyFieldSet);
    }
  }

  validateEventDrivenObjectFields(
    fieldDataByFieldName: Map<string, FieldData>,
    keyFieldNames: Set<string>,
    nonExternalKeyFieldNameByFieldPath: Map<string, string>,
    nonKeyFieldNameByFieldPath: Map<string, string>,
  ) {
    for (const [fieldName, fieldData] of fieldDataByFieldName) {
      const fieldPath = `${fieldData.originalParentTypeName}.${fieldName}`;
      if (keyFieldNames.has(fieldName)) {
        if (!fieldData.isExternalBySubgraphName.get(this.subgraphName)) {
          nonExternalKeyFieldNameByFieldPath.set(fieldPath, fieldName);
        }
        continue;
      }
      nonKeyFieldNameByFieldPath.set(fieldPath, fieldName);
    }
  }

  isPublishEventResultValid(): boolean {
    const data = this.parentDefinitionDataByTypeName.get(PUBLISH_EVENT_RESULT);
    if (!data) {
      return true;
    }
    if (data.kind !== Kind.OBJECT_TYPE_DEFINITION) {
      return false;
    }
    if (data.fieldDataByFieldName.size != 1) {
      return false;
    }
    for (const [fieldName, fieldData] of data.fieldDataByFieldName) {
      if (fieldData.argumentDataByArgumentName.size > 0) {
        return false;
      }
      if (fieldName !== SUCCESS) {
        return false;
      }
      if (printTypeNode(fieldData.type) !== NON_NULLABLE_BOOLEAN) {
        return false;
      }
    }
    return true;
  }

  validateEventDrivenSubgraph() {
    const errorMessages: string[] = [];
    const invalidEventsDirectiveDataByRootFieldPath = new Map<string, InvalidRootTypeFieldEventsDirectiveData>();
    const invalidResponseTypeStringByRootFieldPath = new Map<string, string>();
    const invalidResponseTypeNameByMutationPath = new Map<string, string>();
    const invalidKeyFieldSetsByEntityTypeName = new Map<string, string[]>();
    const nonExternalKeyFieldNameByFieldPath = new Map<string, string>();
    const nonKeyFieldNameByFieldPath = new Map<string, string>();
    const nonEntityExtensionTypeNames = new Set<string>();
    const invalidObjectTypeNames = new Set<string>();
    for (const [typeName, data] of this.parentExtensionDataByTypeName) {
      if (data.kind !== Kind.OBJECT_TYPE_EXTENSION) {
        continue;
      }
      // If a required events directive is returned, the parent type is a root type
      const validEventsDirectiveNames = this.getValidEventsDirectiveNamesForRootTypeName(data.name);
      if (validEventsDirectiveNames) {
        this.validateEventDrivenRootType(
          data,
          validEventsDirectiveNames,
          invalidEventsDirectiveDataByRootFieldPath,
          invalidResponseTypeStringByRootFieldPath,
          invalidResponseTypeNameByMutationPath,
        );
        continue;
      }
      const keyFieldNames = this.keyFieldNamesByParentTypeName.get(typeName);
      if (!keyFieldNames || !data.isEntity) {
        nonEntityExtensionTypeNames.add(typeName);
        continue;
      }
      this.validateEventDrivenKeyDefinition(typeName, invalidKeyFieldSetsByEntityTypeName);
      this.validateEventDrivenObjectFields(
        data.fieldDataByFieldName,
        keyFieldNames,
        nonExternalKeyFieldNameByFieldPath,
        nonKeyFieldNameByFieldPath,
      );
    }
    for (const [typeName, data] of this.parentDefinitionDataByTypeName) {
      if (data.kind !== Kind.OBJECT_TYPE_DEFINITION) {
        continue;
      }
      // validate PublishEventResult separately
      if (typeName === PUBLISH_EVENT_RESULT) {
        continue;
      }
      // If a required events directive is returned, the parent type is a root type
      const validEventsDirectiveNames = this.getValidEventsDirectiveNamesForRootTypeName(data.name);
      if (validEventsDirectiveNames) {
        this.validateEventDrivenRootType(
          data,
          validEventsDirectiveNames,
          invalidEventsDirectiveDataByRootFieldPath,
          invalidResponseTypeStringByRootFieldPath,
          invalidResponseTypeNameByMutationPath,
        );
        continue;
      }
      const keyFieldNames = this.keyFieldNamesByParentTypeName.get(typeName);
      if (!keyFieldNames) {
        invalidObjectTypeNames.add(typeName);
        continue;
      }
      this.validateEventDrivenKeyDefinition(typeName, invalidKeyFieldSetsByEntityTypeName);
      this.validateEventDrivenObjectFields(
        data.fieldDataByFieldName,
        keyFieldNames,
        nonExternalKeyFieldNameByFieldPath,
        nonKeyFieldNameByFieldPath,
      );
    }
    if (!this.isPublishEventResultValid()) {
      errorMessages.push(invalidPublishEventResultObjectErrorMessage);
    }
    if (invalidEventsDirectiveDataByRootFieldPath.size > 0) {
      errorMessages.push(invalidRootTypeFieldEventsDirectivesErrorMessage(invalidEventsDirectiveDataByRootFieldPath));
    }
    if (invalidResponseTypeNameByMutationPath.size > 0) {
      errorMessages.push(invalidEventsDrivenMutationResponseTypeErrorMessage(invalidResponseTypeNameByMutationPath));
    }
    if (invalidResponseTypeStringByRootFieldPath.size > 0) {
      errorMessages.push(
        invalidRootTypeFieldResponseTypesEventDrivenErrorMessage(invalidResponseTypeStringByRootFieldPath),
      );
    }
    if (invalidKeyFieldSetsByEntityTypeName.size > 0) {
      errorMessages.push(invalidKeyFieldSetsEventDrivenErrorMessage(invalidKeyFieldSetsByEntityTypeName));
    }
    if (nonExternalKeyFieldNameByFieldPath.size > 0) {
      errorMessages.push(nonExternalKeyFieldNamesEventDrivenErrorMessage(nonExternalKeyFieldNameByFieldPath));
    }
    if (nonKeyFieldNameByFieldPath.size > 0) {
      errorMessages.push(nonKeyFieldNamesEventDrivenErrorMessage(nonKeyFieldNameByFieldPath));
    }
    if (nonEntityExtensionTypeNames.size > 0) {
      errorMessages.push(nonEntityObjectExtensionsEventDrivenErrorMessage([...nonEntityExtensionTypeNames]));
    }
    if (invalidObjectTypeNames.size > 0) {
      errorMessages.push(nonKeyComposingObjectTypeNamesEventDrivenErrorMessage([...invalidObjectTypeNames]));
    }
    if (errorMessages.length > 0) {
      this.errors.push(invalidEventDrivenGraphError(errorMessages));
    }
  }

  normalize(document: DocumentNode): NormalizationResultContainer {
    /* factory.allDirectiveDefinitions is initialized with v1 directive definitions, and v2 definitions are only added
    after the visitor has visited the entire schema and the subgraph is known to be a V2 graph. Consequently,
    allDirectiveDefinitions cannot be used to check for duplicate definitions, and another set (below) is required */

    // Collect any renamed root types
    upsertDirectiveAndSchemaDefinitions(this, document);
    upsertParentsAndChildren(this, document);
    consolidateAuthorizationDirectives(this, document);
    for (const interfaceTypeName of this.interfaceTypeNamesWithAuthorizationDirectives) {
      const interfaceAuthorizationData = this.authorizationDataByParentTypeName.get(interfaceTypeName);
      if (!interfaceAuthorizationData) {
        continue;
      }
      const concreteTypeNames = this.concreteTypeNamesByAbstractTypeName.get(interfaceTypeName);
      for (const concreteTypeName of concreteTypeNames || []) {
        const concreteAuthorizationData = getValueOrDefault(
          this.authorizationDataByParentTypeName,
          concreteTypeName,
          () => newAuthorizationData(concreteTypeName),
        );
        for (const [
          fieldName,
          interfaceFieldAuthorizationData,
        ] of interfaceAuthorizationData.fieldAuthorizationDataByFieldName) {
          if (
            !upsertFieldAuthorizationData(
              concreteAuthorizationData.fieldAuthorizationDataByFieldName,
              interfaceFieldAuthorizationData,
            )
          ) {
            this.invalidOrScopesHostPaths.add(`${concreteTypeName}.${fieldName}`);
          }
        }
      }
    }
    // Apply inherited leaf authorization that was not applied to interface fields of that type earlier
    for (const [typeName, fieldAuthorizationDatas] of this.heirFieldAuthorizationDataByTypeName) {
      const authorizationData = this.authorizationDataByParentTypeName.get(typeName);
      if (!authorizationData) {
        continue;
      }
      for (const fieldAuthorizationData of fieldAuthorizationDatas) {
        if (!mergeAuthorizationDataByAND(authorizationData, fieldAuthorizationData)) {
          this.invalidOrScopesHostPaths.add(`${typeName}.${fieldAuthorizationData.fieldName}`);
        }
      }
    }
    if (this.invalidOrScopesHostPaths.size > 0) {
      this.errors.push(orScopesLimitError(maxOrScopes, [...this.invalidOrScopesHostPaths]));
    }
    const definitions: DefinitionNode[] = [];
    for (const directiveDefinition of BASE_DIRECTIVE_DEFINITIONS) {
      definitions.push(directiveDefinition);
    }
    definitions.push(FIELD_SET_SCALAR_DEFINITION);
    if (this.isSubgraphVersionTwo) {
      for (const directiveDefinition of VERSION_TWO_DIRECTIVE_DEFINITIONS) {
        definitions.push(directiveDefinition);
        this.directiveDefinitionByDirectiveName.set(directiveDefinition.name.value, directiveDefinition);
      }
      definitions.push(SCOPE_SCALAR_DEFINITION);
    }
    for (const directiveDefinition of this.customDirectiveDefinitions.values()) {
      definitions.push(directiveDefinition);
    }
    if (this.schemaDefinition.operationTypes.size > 0) {
      definitions.push(
        getSchemaNodeByData(this.schemaDefinition, this.errors, this.directiveDefinitionByDirectiveName),
      );
    }

    const validParentExtensionOrphansByTypeName = new Map<string, ObjectExtensionData>();
    const handledParentTypeNames = new Set<string>();
    for (const [extensionTypeName, parentExtensionData] of this.parentExtensionDataByTypeName) {
      const isEntity = this.entityDataByTypeName.has(extensionTypeName);
      const newParentTypeName =
        parentExtensionData.kind === Kind.OBJECT_TYPE_EXTENSION
          ? parentExtensionData.renamedTypeName || extensionTypeName
          : extensionTypeName;
      const configurationData: ConfigurationData = {
        fieldNames: new Set<string>(),
        isRootNode: isEntity,
        typeName: newParentTypeName,
      };
      this.configurationDataByParentTypeName.set(newParentTypeName, configurationData);
      if (parentExtensionData.kind === Kind.OBJECT_TYPE_EXTENSION) {
        if (this.operationTypeNodeByTypeName.has(extensionTypeName)) {
          configurationData.isRootNode = true;
          parentExtensionData.fieldDataByFieldName.delete(SERVICE_FIELD);
          parentExtensionData.fieldDataByFieldName.delete(ENTITIES_FIELD);
        }
        addNonExternalFieldsToSet(parentExtensionData.fieldDataByFieldName, configurationData.fieldNames);
      }
      const parentDefinitionData = this.parentDefinitionDataByTypeName.get(extensionTypeName);
      if (!parentDefinitionData) {
        if (parentExtensionData.kind !== Kind.OBJECT_TYPE_EXTENSION) {
          this.errors.push(noBaseTypeExtensionError(extensionTypeName));
        } else {
          this.validateInterfaceImplementations(parentExtensionData);
          validParentExtensionOrphansByTypeName.set(extensionTypeName, parentExtensionData);
          definitions.push(
            getParentWithFieldsNodeByData(
              parentExtensionData,
              this.errors,
              this.directiveDefinitionByDirectiveName,
              this.authorizationDataByParentTypeName,
            ),
          );
        }
        continue;
      }
      if (!areBaseAndExtensionKindsCompatible(parentDefinitionData.kind, parentExtensionData.kind, extensionTypeName)) {
        this.errors.push(
          incompatibleExtensionError(extensionTypeName, parentDefinitionData.kind, parentExtensionData.kind),
        );
        continue;
      }
      switch (parentDefinitionData.kind) {
        case Kind.ENUM_TYPE_DEFINITION:
          const enumExtensionData = parentExtensionData as EnumExtensionData;
          for (const [valueName, enumValueDefinitionNode] of enumExtensionData.enumValueDataByValueName) {
            if (!parentDefinitionData.enumValueDataByValueName.has(valueName)) {
              parentDefinitionData.enumValueDataByValueName.set(valueName, enumValueDefinitionNode);
              continue;
            }
            this.errors.push(duplicateEnumValueDefinitionError(valueName, extensionTypeName));
          }
          definitions.push(
            getEnumNodeByData(
              parentDefinitionData,
              this.errors,
              this.directiveDefinitionByDirectiveName,
              this.authorizationDataByParentTypeName,
              enumExtensionData,
            ),
          );
          break;
        case Kind.INPUT_OBJECT_TYPE_DEFINITION:
          const inputObjectExtensionData = parentExtensionData as InputObjectExtensionData;
          for (const [fieldName, inputValueDefinitionNode] of inputObjectExtensionData.inputValueDataByValueName) {
            if (!parentDefinitionData.inputValueDataByValueName.has(fieldName)) {
              parentDefinitionData.inputValueDataByValueName.set(fieldName, inputValueDefinitionNode);
              continue;
            }
            this.errors.push(duplicateFieldDefinitionError(fieldName, extensionTypeName));
          }
          definitions.push(
            getInputObjectNodeByData(
              parentDefinitionData,
              this.errors,
              this.directiveDefinitionByDirectiveName,
              this.authorizationDataByParentTypeName,
              inputObjectExtensionData,
            ),
          );
          break;
        case Kind.INTERFACE_TYPE_DEFINITION:
        // intentional fallthrough
        case Kind.OBJECT_TYPE_DEFINITION:
          const extensionWithFieldsData = parentExtensionData as ExtensionWithFieldsData;
          const operationTypeNode = this.operationTypeNodeByTypeName.get(extensionTypeName);
          if (operationTypeNode) {
            configurationData.isRootNode = true;
            extensionWithFieldsData.fieldDataByFieldName.delete(SERVICE_FIELD);
            extensionWithFieldsData.fieldDataByFieldName.delete(ENTITIES_FIELD);
          }
          for (const [fieldName, fieldData] of extensionWithFieldsData.fieldDataByFieldName) {
            if (fieldData.argumentDataByArgumentName.size > 0) {
              // Arguments can only be fully validated once all parents types are known
              this.validateArguments(fieldData, `${extensionTypeName}.${fieldName}`);
            }
            if (parentDefinitionData.fieldDataByFieldName.has(fieldName)) {
              this.errors.push(duplicateFieldDefinitionError(fieldName, extensionTypeName));
              continue;
            }
            parentDefinitionData.fieldDataByFieldName.set(fieldName, fieldData);
            if (!fieldData.argumentDataByArgumentName.has(EXTERNAL)) {
              configurationData.fieldNames.add(fieldName);
            }
          }
          this.mergeUniqueInterfaces(
            extensionWithFieldsData.implementedInterfaceTypeNames,
            parentDefinitionData.implementedInterfaceTypeNames,
            extensionTypeName,
          );
          this.validateInterfaceImplementations(parentDefinitionData);
          definitions.push(
            getParentWithFieldsNodeByData(
              parentDefinitionData,
              this.errors,
              this.directiveDefinitionByDirectiveName,
              this.authorizationDataByParentTypeName,
              extensionWithFieldsData,
            ),
          );
          // Interfaces and objects must define at least one field
          if (
            parentDefinitionData.fieldDataByFieldName.size < 1 &&
            !isNodeQuery(extensionTypeName, operationTypeNode)
          ) {
            this.errors.push(noFieldDefinitionsError(kindToTypeString(parentDefinitionData.kind), extensionTypeName));
          }
          // Add the non-external base type field names to the configuration data
          addNonExternalFieldsToSet(parentDefinitionData.fieldDataByFieldName, configurationData.fieldNames);
          break;
        case Kind.SCALAR_TYPE_DEFINITION:
          definitions.push(
            getScalarNodeByData(
              parentDefinitionData,
              this.errors,
              this.directiveDefinitionByDirectiveName,
              parentExtensionData as ScalarExtensionData,
            ),
          );
          break;
        case Kind.UNION_TYPE_DEFINITION:
          definitions.push(
            getUnionNodeByData(
              parentDefinitionData,
              this.errors,
              this.directiveDefinitionByDirectiveName,
              parentExtensionData as UnionExtensionData,
            ),
          );
          break;
        default:
          throw unexpectedKindFatalError(extensionTypeName);
      }
      // At this point, the base type has been dealt with, so it doesn't need to be dealt with again
      handledParentTypeNames.add(extensionTypeName);
    }
    for (const [parentTypeName, parentDefinitionData] of this.parentDefinitionDataByTypeName) {
      if (handledParentTypeNames.has(parentTypeName)) {
        continue;
      }
      switch (parentDefinitionData.kind) {
        case Kind.ENUM_TYPE_DEFINITION:
          definitions.push(
            getEnumNodeByData(
              parentDefinitionData,
              this.errors,
              this.directiveDefinitionByDirectiveName,
              this.authorizationDataByParentTypeName,
            ),
          );
          break;
        case Kind.INPUT_OBJECT_TYPE_DEFINITION:
          definitions.push(
            getInputObjectNodeByData(
              parentDefinitionData,
              this.errors,
              this.directiveDefinitionByDirectiveName,
              this.authorizationDataByParentTypeName,
            ),
          );
          break;
        case Kind.INTERFACE_TYPE_DEFINITION:
        // intentional fallthrough
        case Kind.OBJECT_TYPE_DEFINITION:
          const isEntity = this.entityDataByTypeName.has(parentTypeName);
          const operationTypeNode = this.operationTypeNodeByTypeName.get(parentTypeName);
          if (operationTypeNode) {
            parentDefinitionData.fieldDataByFieldName.delete(SERVICE_FIELD);
            parentDefinitionData.fieldDataByFieldName.delete(ENTITIES_FIELD);
          }
          if (this.parentsWithChildArguments.has(parentTypeName)) {
            if (
              parentDefinitionData.kind !== Kind.OBJECT_TYPE_DEFINITION &&
              parentDefinitionData.kind !== Kind.INTERFACE_TYPE_DEFINITION
            ) {
              continue;
            }
            for (const [fieldName, fieldData] of parentDefinitionData.fieldDataByFieldName) {
              // Arguments can only be fully validated once all parents types are known
              this.validateArguments(fieldData, `${parentTypeName}.${fieldName}`);
            }
          }
          const newParentTypeName =
            parentDefinitionData.kind === Kind.OBJECT_TYPE_DEFINITION
              ? parentDefinitionData.renamedTypeName || parentTypeName
              : parentTypeName;
          const configurationData: ConfigurationData = {
            fieldNames: new Set<string>(),
            isRootNode: isEntity,
            typeName: newParentTypeName,
          };
          const entityInterfaceData = this.entityInterfaces.get(parentTypeName);
          if (entityInterfaceData) {
            entityInterfaceData.concreteTypeNames =
              this.concreteTypeNamesByAbstractTypeName.get(parentTypeName) || new Set<string>();
            configurationData.isInterfaceObject = entityInterfaceData.isInterfaceObject;
            configurationData.entityInterfaceConcreteTypeNames = entityInterfaceData.concreteTypeNames;
          }
          const events = this.eventsConfigurations.get(newParentTypeName);
          if (events) {
            configurationData.events = events;
          }
          this.configurationDataByParentTypeName.set(newParentTypeName, configurationData);
          addNonExternalFieldsToSet(parentDefinitionData.fieldDataByFieldName, configurationData.fieldNames);
          this.validateInterfaceImplementations(parentDefinitionData);
          definitions.push(
            getParentWithFieldsNodeByData(
              parentDefinitionData,
              this.errors,
              this.directiveDefinitionByDirectiveName,
              this.authorizationDataByParentTypeName,
            ),
          );
          // interfaces and objects must define at least one field
          if (parentDefinitionData.fieldDataByFieldName.size < 1 && !isNodeQuery(parentTypeName, operationTypeNode)) {
            this.errors.push(noFieldDefinitionsError(kindToTypeString(parentDefinitionData.kind), parentTypeName));
          }
          break;
        case Kind.SCALAR_TYPE_DEFINITION:
          definitions.push(
            getScalarNodeByData(parentDefinitionData, this.errors, this.directiveDefinitionByDirectiveName),
          );
          break;
        case Kind.UNION_TYPE_DEFINITION:
          definitions.push(
            getUnionNodeByData(parentDefinitionData, this.errors, this.directiveDefinitionByDirectiveName),
          );
          break;
        default:
          throw unexpectedKindFatalError(parentTypeName);
      }
    }
    // Check that explicitly defined operations types are valid objects and that their fields are also valid
    for (const operationType of Object.values(OperationTypeNode)) {
      const operationTypeNode = this.schemaDefinition.operationTypes.get(operationType);
      const defaultTypeName = getOrThrowError(operationTypeNodeToDefaultType, operationType, OPERATION_TO_DEFAULT);
      // If an operation type name was not declared, use the default
      const operationTypeName = operationTypeNode ? getTypeNodeNamedTypeName(operationTypeNode.type) : defaultTypeName;
      // If a custom type is used, the default type should not be defined
      if (
        operationTypeName !== defaultTypeName &&
        (this.parentDefinitionDataByTypeName.has(defaultTypeName) ||
          this.parentExtensionDataByTypeName.has(defaultTypeName))
      ) {
        this.errors.push(invalidRootTypeDefinitionError(operationType, operationTypeName, defaultTypeName));
        continue;
      }
      const objectData = this.parentDefinitionDataByTypeName.get(operationTypeName);
      const extensionData = this.parentExtensionDataByTypeName.get(operationTypeName);
      // operationTypeNode is truthy if an operation type was explicitly declared
      if (operationTypeNode) {
        // If the type is not defined in the schema, it's always an error
        if (!objectData && !extensionData) {
          this.errors.push(undefinedTypeError(operationTypeName));
          continue;
        }
        // Add the explicitly defined type to the map for the federation-factory
        this.operationTypeNodeByTypeName.set(operationTypeName, operationType);
      }
      if (!objectData && !extensionData) {
        continue;
      }
      const rootNode = this.configurationDataByParentTypeName.get(defaultTypeName);
      if (rootNode) {
        rootNode.isRootNode = true;
        rootNode.typeName = defaultTypeName;
      }
      const parentDatas = [objectData, extensionData];
      for (const parentData of parentDatas) {
        if (!parentData) {
          continue;
        }
        if (parentData.kind !== Kind.OBJECT_TYPE_DEFINITION && parentData.kind !== Kind.OBJECT_TYPE_EXTENSION) {
          this.errors.push(operationDefinitionError(operationTypeName, operationType, parentData.kind));
          continue;
        }
        // Root types fields whose response type is an extension orphan could be valid through a federated graph
        // However, the field would have to be shareable to ever be valid TODO
        for (const fieldData of parentData.fieldDataByFieldName.values()) {
          const fieldTypeName = getTypeNodeNamedTypeName(fieldData.node.type);
          if (
            !BASE_SCALARS.has(fieldTypeName) &&
            !this.parentDefinitionDataByTypeName.has(fieldTypeName) &&
            !validParentExtensionOrphansByTypeName.has(fieldTypeName)
          ) {
            this.errors.push(undefinedTypeError(fieldTypeName));
          }
        }
      }
    }
    for (const referencedTypeName of this.referencedTypeNames) {
      if (
        this.parentDefinitionDataByTypeName.has(referencedTypeName) ||
        this.entityDataByTypeName.has(referencedTypeName)
      ) {
        continue;
      }
      const extension = this.parentExtensionDataByTypeName.get(referencedTypeName);
      if (!extension || extension.kind !== Kind.OBJECT_TYPE_EXTENSION) {
        this.errors.push(undefinedTypeError(referencedTypeName));
      }
    }
    for (const [parentTypeName, fieldSetData] of this.fieldSetDataByTypeName) {
      const parentData =
        this.parentDefinitionDataByTypeName.get(parentTypeName) ||
        this.parentExtensionDataByTypeName.get(parentTypeName);
      if (
        !parentData ||
        (parentData.kind !== Kind.OBJECT_TYPE_DEFINITION &&
          parentData.kind != Kind.OBJECT_TYPE_EXTENSION &&
          parentData.kind !== Kind.INTERFACE_TYPE_DEFINITION &&
          parentData.kind !== Kind.INTERFACE_TYPE_EXTENSION)
      ) {
        this.errors.push(undefinedObjectLikeParentError(parentTypeName));
        continue;
      }
      // this is where keys, provides, and requires are added to the ConfigurationData
      validateAndAddDirectivesWithFieldSetToConfigurationData(this, parentData, fieldSetData);
    }
    const persistedDirectiveDefinitionDataByDirectiveName = new Map<string, PersistedDirectiveDefinitionData>();
    for (const directiveDefinitionNode of this.directiveDefinitionByDirectiveName.values()) {
      // TODO @composeDirective directives would also be handled here
      const executableLocations = extractExecutableDirectiveLocations(
        directiveDefinitionNode.locations,
        new Set<string>(),
      );
      if (executableLocations.size < 1) {
        continue;
      }
      addPersistedDirectiveDefinitionDataByNode(
        persistedDirectiveDefinitionDataByDirectiveName,
        directiveDefinitionNode,
        this.errors,
        this.directiveDefinitionByDirectiveName,
        this.handledRepeatedDirectivesByHostPath,
        executableLocations,
        this.subgraphName,
      );
    }
    if (this.isEventDrivenSubgraph) {
      this.validateEventDrivenSubgraph();
    }
    if (this.errors.length > 0) {
      return { errors: this.errors };
    }
    const newAST: DocumentNode = {
      kind: Kind.DOCUMENT,
      definitions,
    };
    return {
      normalizationResult: {
        authorizationDataByParentTypeName: this.authorizationDataByParentTypeName,
        // configurationDataMap is map of ConfigurationData per type name.
        // It is an Intermediate configuration object that will be converted to an engine configuration in the router
        concreteTypeNamesByAbstractTypeName: this.concreteTypeNamesByAbstractTypeName,
        configurationDataByParentTypeName: this.configurationDataByParentTypeName,
        entityContainerByTypeName: this.entityDataByTypeName,
        entityInterfaces: this.entityInterfaces,
        parentDefinitionDataByTypeName: this.parentDefinitionDataByTypeName,
        parentExtensionDataByTypeName: validParentExtensionOrphansByTypeName,
        isVersionTwo: this.isSubgraphVersionTwo,
        keyFieldNamesByParentTypeName: this.keyFieldNamesByParentTypeName,
        operationTypes: this.operationTypeNodeByTypeName,
        originalTypeNameByRenamedTypeName: this.originalTypeNameByRenamedTypeName,
        overridesByTargetSubgraphName: this.overridesByTargetSubgraphName,
        parentDataByTypeName: this.parentDefinitionDataByTypeName,
        persistedDirectiveDefinitionDataByDirectiveName,
        subgraphAST: newAST,
        subgraphString: print(newAST),
        schema: buildASTSchema(newAST, { assumeValid: true }),
      },
    };
  }
}

export function batchNormalize(subgraphs: Subgraph[]): BatchNormalizationContainer {
  const authorizationDataByParentTypeName = new Map<string, AuthorizationData>();
  const concreteTypeNamesByAbstractTypeName = new Map<string, Set<string>>();
  const entityDataByTypeName: EntityDataByTypeName = new Map<string, EntityData>();
  const internalSubgraphBySubgraphName = new Map<string, InternalSubgraph>();
  const allOverridesByTargetSubgraphName = new Map<string, Map<string, Set<string>>>();
  const overrideSourceSubgraphNamesByFieldPath = new Map<string, string[]>();
  const duplicateOverriddenFieldPaths = new Set<string>();
  const parentDefinitionDataMapsBySubgraphName = new Map<string, Map<string, ParentDefinitionData>>();
  const subgraphNames = new Set<string>();
  const nonUniqueSubgraphNames = new Set<string>();
  const invalidNameErrorMessages: string[] = [];
  const invalidOrScopesHostPaths = new Set<string>();
  const warnings: string[] = [];
  const validationErrors: Error[] = [];
  // Record the subgraph names first, so that subgraph references can be validated
  for (const subgraph of subgraphs) {
    if (subgraph.name) {
      recordSubgraphName(subgraph.name, subgraphNames, nonUniqueSubgraphNames);
    }
  }
  const graph = new MultiGraph();
  for (let i = 0; i < subgraphs.length; i++) {
    const subgraph = subgraphs[i];
    const subgraphName = subgraph.name || `subgraph-${i}-${Date.now()}`;
    if (!subgraph.name) {
      invalidNameErrorMessages.push(invalidSubgraphNameErrorMessage(i, subgraphName));
    }
    const { errors, normalizationResult } = normalizeSubgraph(subgraph.definitions, graph, subgraph.name);
    if (errors) {
      validationErrors.push(subgraphValidationError(subgraphName, errors));
      continue;
    }
    if (!normalizationResult) {
      validationErrors.push(subgraphValidationError(subgraphName, [subgraphValidationFailureError]));
      continue;
    }

    parentDefinitionDataMapsBySubgraphName.set(subgraphName, normalizationResult.parentDataByTypeName);

    for (const authorizationData of normalizationResult.authorizationDataByParentTypeName.values()) {
      upsertAuthorizationData(authorizationDataByParentTypeName, authorizationData, invalidOrScopesHostPaths);
    }
    for (const [
      abstractTypeName,
      incomingConcreteTypeNames,
    ] of normalizationResult.concreteTypeNamesByAbstractTypeName) {
      const existingConcreteTypeNames = concreteTypeNamesByAbstractTypeName.get(abstractTypeName);
      if (!existingConcreteTypeNames) {
        concreteTypeNamesByAbstractTypeName.set(abstractTypeName, new Set<string>(incomingConcreteTypeNames));
        continue;
      }
      addIterableValuesToSet(incomingConcreteTypeNames, existingConcreteTypeNames);
    }
    for (const entityContainer of normalizationResult.entityContainerByTypeName.values()) {
      upsertEntityData(entityDataByTypeName, entityContainer);
    }
    if (subgraph.name) {
      internalSubgraphBySubgraphName.set(subgraphName, {
        configurationDataByParentTypeName: normalizationResult.configurationDataByParentTypeName,
        definitions: normalizationResult.subgraphAST,
        entityInterfaces: normalizationResult.entityInterfaces,
        keyFieldNamesByParentTypeName: normalizationResult.keyFieldNamesByParentTypeName,
        isVersionTwo: normalizationResult.isVersionTwo,
        name: subgraphName,
        operationTypes: normalizationResult.operationTypes,
        overriddenFieldNamesByParentTypeName: new Map<string, Set<string>>(),
        parentDefinitionDataByTypeName: normalizationResult.parentDataByTypeName,
        parentExtensionDataByTypeName: normalizationResult.parentExtensionDataByTypeName,
        persistedDirectiveDefinitionDataByDirectiveName:
          normalizationResult.persistedDirectiveDefinitionDataByDirectiveName,
        schema: normalizationResult.schema,
        url: subgraph.url,
      });
    }
    if (normalizationResult.overridesByTargetSubgraphName.size < 1) {
      continue;
    }
    for (const [targetSubgraphName, overridesData] of normalizationResult.overridesByTargetSubgraphName) {
      const isTargetValid = subgraphNames.has(targetSubgraphName);
      for (const [parentTypeName, fieldNames] of overridesData) {
        /* It's possible for a renamed root type to have a field overridden, so make sure any errors at this stage are
           propagated with the original typename. */
        const originalParentTypeName =
          normalizationResult.originalTypeNameByRenamedTypeName.get(parentTypeName) || parentTypeName;
        if (!isTargetValid) {
          warnings.push(
            invalidOverrideTargetSubgraphNameWarning(targetSubgraphName, originalParentTypeName, [...fieldNames]),
          );
        } else {
          const overridesData = getValueOrDefault(
            allOverridesByTargetSubgraphName,
            targetSubgraphName,
            () => new Map<string, Set<string>>(),
          );
          const existingFieldNames = getValueOrDefault(
            overridesData,
            parentTypeName,
            () => new Set<string>(fieldNames),
          );
          addIterableValuesToSet(fieldNames, existingFieldNames);
        }
        for (const fieldName of fieldNames) {
          const fieldPath = `${originalParentTypeName}.${fieldName}`;
          const sourceSubgraphs = overrideSourceSubgraphNamesByFieldPath.get(fieldPath);
          if (!sourceSubgraphs) {
            overrideSourceSubgraphNamesByFieldPath.set(fieldPath, [subgraphName]);
            continue;
          }
          sourceSubgraphs.push(subgraphName);
          duplicateOverriddenFieldPaths.add(fieldPath);
        }
      }
    }
  }
  const allErrors: Error[] = [];
  if (invalidOrScopesHostPaths.size > 0) {
    allErrors.push(orScopesLimitError(maxOrScopes, [...invalidOrScopesHostPaths]));
  }
  if (invalidNameErrorMessages.length > 0 || nonUniqueSubgraphNames.size > 0) {
    allErrors.push(invalidSubgraphNamesError([...nonUniqueSubgraphNames], invalidNameErrorMessages));
  }
  if (duplicateOverriddenFieldPaths.size > 0) {
    const duplicateOverriddenFieldErrorMessages: string[] = [];
    for (const fieldPath of duplicateOverriddenFieldPaths) {
      const sourceSubgraphNames = getOrThrowError(
        overrideSourceSubgraphNamesByFieldPath,
        fieldPath,
        'overrideSourceSubgraphNamesByFieldPath',
      );
      duplicateOverriddenFieldErrorMessages.push(duplicateOverriddenFieldErrorMessage(fieldPath, sourceSubgraphNames));
    }
    allErrors.push(duplicateOverriddenFieldsError(duplicateOverriddenFieldErrorMessages));
  }
  allErrors.push(...validationErrors);
  if (allErrors.length > 0) {
    return {
      authorizationDataByParentTypeName,
      concreteTypeNamesByAbstractTypeName,
      entityContainerByTypeName: entityDataByTypeName,
      errors: allErrors,
      graph,
      internalSubgraphBySubgraphName,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }
  for (const [targetSubgraphName, overridesData] of allOverridesByTargetSubgraphName) {
    const internalSubgraph = getOrThrowError(
      internalSubgraphBySubgraphName,
      targetSubgraphName,
      'internalSubgraphBySubgraphName',
    );
    internalSubgraph.overriddenFieldNamesByParentTypeName = overridesData;
    for (const [parentTypeName, fieldNames] of overridesData) {
      const configurationData = internalSubgraph.configurationDataByParentTypeName.get(parentTypeName);
      if (!configurationData) {
        continue;
      }
      subtractSourceSetFromTargetSet(fieldNames, configurationData.fieldNames);
      if (configurationData.fieldNames.size < 1) {
        internalSubgraph.configurationDataByParentTypeName.delete(parentTypeName);
      }
    }
  }
  return {
    authorizationDataByParentTypeName,
    concreteTypeNamesByAbstractTypeName,
    entityContainerByTypeName: entityDataByTypeName,
    graph,
    internalSubgraphBySubgraphName: internalSubgraphBySubgraphName,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
