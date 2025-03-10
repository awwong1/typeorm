import {Repository} from "./Repository";
import {SelectQueryBuilder} from "../query-builder/SelectQueryBuilder";
import {ObjectLiteral} from "../common/ObjectLiteral";
import {AbstractSqliteDriver} from "../driver/sqlite-abstract/AbstractSqliteDriver";
import {QueryBuilder} from "../query-builder/QueryBuilder";

/**
 * Repository with additional functions to work with trees.
 *
 * @see Repository
 */
export class TreeRepository<Entity> extends Repository<Entity> {

    // todo: implement moving
    // todo: implement removing

    // -------------------------------------------------------------------------
    // Public Methods
    // -------------------------------------------------------------------------

    /**
     * Gets complete trees for all roots in the table.
     */
    async findTrees(): Promise<Entity[]> {
        const roots = await this.findRoots();
        await Promise.all(roots.map(root => this.findDescendantsTree(root)));
        return roots;
    }

    /**
     * Roots are entities that have no ancestors. Finds them all.
     */
    findRoots(): Promise<Entity[]> {
        const escapeAlias = (alias: string) => this.manager.connection.driver.escape(alias);
        const escapeColumn = (column: string) => this.manager.connection.driver.escape(column);
        const parentPropertyName = this.manager.connection.namingStrategy.joinColumnName(
          this.metadata.treeParentRelation!.propertyName, "id"
        );

        return this.createQueryBuilder("treeEntity")
            .where(`${escapeAlias("treeEntity")}.${escapeColumn(parentPropertyName)} IS NULL`)
            .getMany();
    }

    /**
     * Gets all children (descendants) of the given entity. Returns them all in a flat array.
     */
    findDescendants(entity: Entity): Promise<Entity[]> {
        return this
            .createDescendantsQueryBuilder("treeEntity", "treeClosure", entity)
            .getMany();
    }

    /**
     * Gets all children (descendants) of the given entity. Returns them in a tree - nested into each other.
     */
    findDescendantsTree(entity: Entity): Promise<Entity> {
        // todo: throw exception if there is no column of this relation?
        return this
            .createDescendantsQueryBuilder("treeEntity", "treeClosure", entity)
            .getRawAndEntities()
            .then(entitiesAndScalars => {
                const relationMaps = this.createRelationMaps("treeEntity", entitiesAndScalars.raw);
                this.buildChildrenEntityTree(entity, entitiesAndScalars.entities, relationMaps);
                return entity;
            });
    }

    /**
     * Gets number of descendants of the entity.
     */
    countDescendants(entity: Entity): Promise<number> {
        return this
            .createDescendantsQueryBuilder("treeEntity", "treeClosure", entity)
            .getCount();
    }

    /**
     * Creates a query builder used to get descendants of the entities in a tree.
     */
    createDescendantsQueryBuilder(alias: string, closureTableAlias: string, entity: Entity): SelectQueryBuilder<Entity> {

        // create shortcuts for better readability
        const escape = (alias: string) => this.manager.connection.driver.escape(alias);

        if (this.metadata.treeType === "closure-table") {

            const joinCondition = this.metadata.closureJunctionTable.descendantColumns.map(column => {
                return escape(closureTableAlias) + "." + escape(column.propertyPath) + " = " + escape(alias) + "." + escape(column.referencedColumn!.propertyPath);
            }).join(" AND ");

            const parameters: ObjectLiteral = {};
            const whereCondition = this.metadata.closureJunctionTable.ancestorColumns.map(column => {
                parameters[column.referencedColumn!.propertyName] = column.referencedColumn!.getEntityValue(entity);
                return escape(closureTableAlias) + "." + escape(column.propertyPath) + " = :" + column.referencedColumn!.propertyName;
            }).join(" AND ");

            return this
                .createQueryBuilder(alias)
                .innerJoin(this.metadata.closureJunctionTable.tableName, closureTableAlias, joinCondition)
                .where(whereCondition)
                .setParameters(parameters);

        } else if (this.metadata.treeType === "nested-set") {

            const whereCondition = alias + "." + this.metadata.nestedSetLeftColumn!.propertyPath + " BETWEEN " +
                "joined." + this.metadata.nestedSetLeftColumn!.propertyPath + " AND joined." + this.metadata.nestedSetRightColumn!.propertyPath;
            const parameters: ObjectLiteral = {};
            const joinCondition = this.metadata.treeParentRelation!.joinColumns.map(joinColumn => {
                const parameterName = joinColumn.referencedColumn!.propertyPath.replace(".", "_");
                parameters[parameterName] = joinColumn.referencedColumn!.getEntityValue(entity);
                return "joined." + joinColumn.referencedColumn!.propertyPath + " = :" + parameterName;
            }).join(" AND ");

            return this
                .createQueryBuilder(alias)
                .innerJoin(this.metadata.targetName, "joined", whereCondition)
                .where(joinCondition, parameters);

        } else if (this.metadata.treeType === "materialized-path") {
            return this
                .createQueryBuilder(alias)
                .where(qb => {
                    const subQuery = qb.subQuery()
                        .select(`${this.metadata.targetName}.${this.metadata.materializedPathColumn!.propertyPath}`, "path")
                        .from(this.metadata.target, this.metadata.targetName)
                        .whereInIds(this.metadata.getEntityIdMap(entity));

                    qb.setNativeParameters(subQuery.expressionMap.nativeParameters);
                    if (this.manager.connection.driver instanceof AbstractSqliteDriver) {
                        return `${alias}.${this.metadata.materializedPathColumn!.propertyPath} LIKE ${subQuery.getQuery()} || '%'`;
                    } else {
                        return `${alias}.${this.metadata.materializedPathColumn!.propertyPath} LIKE CONCAT(${subQuery.getQuery()}, '%')`;
                    }
                });
        }

        throw new Error(`Supported only in tree entities`);
    }

    /**
     * Gets all parents (ancestors) of the given entity. Returns them all in a flat array.
     */
    findAncestors(entity: Entity): Promise<Entity[]> {
        return this
            .createAncestorsQueryBuilder("treeEntity", "treeClosure", entity)
            .getMany();
    }

    /**
     * Gets all parents (ancestors) of the given entity. Returns them in a tree - nested into each other.
     */
    findAncestorsTree(entity: Entity): Promise<Entity> {
        // todo: throw exception if there is no column of this relation?
        return this
            .createAncestorsQueryBuilder("treeEntity", "treeClosure", entity)
            .getRawAndEntities()
            .then(entitiesAndScalars => {
                const relationMaps = this.createRelationMaps("treeEntity", entitiesAndScalars.raw);
                this.buildParentEntityTree(entity, entitiesAndScalars.entities, relationMaps);
                return entity;
            });
    }

    /**
     * Gets number of ancestors of the entity.
     */
    countAncestors(entity: Entity): Promise<number> {
        return this
            .createAncestorsQueryBuilder("treeEntity", "treeClosure", entity)
            .getCount();
    }

    /**
     * Creates a query builder used to get ancestors of the entities in the tree.
     */
    createAncestorsQueryBuilder(alias: string, closureTableAlias: string, entity: Entity): SelectQueryBuilder<Entity> {

        // create shortcuts for better readability
        // const escape = (alias: string) => this.manager.connection.driver.escape(alias);

        if (this.metadata.treeType === "closure-table") {
            const joinCondition = this.metadata.closureJunctionTable.ancestorColumns.map(column => {
                return closureTableAlias + "." + column.propertyPath + " = " + alias + "." + column.referencedColumn!.propertyPath;
            }).join(" AND ");

            const parameters: ObjectLiteral = {};
            const whereCondition = this.metadata.closureJunctionTable.descendantColumns.map(column => {
                parameters[column.referencedColumn!.propertyName] = column.referencedColumn!.getEntityValue(entity);
                return closureTableAlias + "." + column.propertyPath + " = :" + column.referencedColumn!.propertyName;
            }).join(" AND ");

            return this
                .createQueryBuilder(alias)
                .innerJoin(this.metadata.closureJunctionTable.tableName, closureTableAlias, joinCondition)
                .where(whereCondition)
                .setParameters(parameters);

        } else if (this.metadata.treeType === "nested-set") {

            const joinCondition = "joined." + this.metadata.nestedSetLeftColumn!.propertyPath + " BETWEEN " +
                alias + "." + this.metadata.nestedSetLeftColumn!.propertyPath + " AND " + alias + "." + this.metadata.nestedSetRightColumn!.propertyPath;
            const parameters: ObjectLiteral = {};
            const whereCondition = this.metadata.treeParentRelation!.joinColumns.map(joinColumn => {
                const parameterName = joinColumn.referencedColumn!.propertyPath.replace(".", "_");
                parameters[parameterName] = joinColumn.referencedColumn!.getEntityValue(entity);
                return "joined." + joinColumn.referencedColumn!.propertyPath + " = :" + parameterName;
            }).join(" AND ");

            return this
                .createQueryBuilder(alias)
                .innerJoin(this.metadata.targetName, "joined", joinCondition)
                .where(whereCondition, parameters);


        } else if (this.metadata.treeType === "materialized-path") {
            // example: SELECT * FROM category category WHERE (SELECT mpath FROM `category` WHERE id = 2) LIKE CONCAT(category.mpath, '%');
            return this
                .createQueryBuilder(alias)
                .where(qb => {
                    const subQuery = qb.subQuery()
                        .select(`${this.metadata.targetName}.${this.metadata.materializedPathColumn!.propertyPath}`, "path")
                        .from(this.metadata.target, this.metadata.targetName)
                        .whereInIds(this.metadata.getEntityIdMap(entity));

                    qb.setNativeParameters(subQuery.expressionMap.nativeParameters);
                    if (this.manager.connection.driver instanceof AbstractSqliteDriver) {
                        return `${subQuery.getQuery()} LIKE ${alias}.${this.metadata.materializedPathColumn!.propertyPath} || '%'`;

                    } else {
                        return `${subQuery.getQuery()} LIKE CONCAT(${alias}.${this.metadata.materializedPathColumn!.propertyPath}, '%')`;
                    }
                });
        }

        throw new Error(`Supported only in tree entities`);
    }

    /**
     * Moves an entity to a given entity's children, or to root.
     */
    async move(entity: Entity, to: Entity | null): Promise<void> {
        const moveQueries = await this.moveEntityQueriesBuilder("treeEntity", "treeClosure", entity, to);

        await this.manager.transaction(async transactionManager => {
            for (const moveQuery of moveQueries) {
                moveQuery.setQueryRunner(transactionManager.queryRunner!);
                await moveQuery.execute();
            }
            // update the entity relation to `to`
            const joinColumn = this.metadata.treeParentRelation!.joinColumns[0];
            joinColumn.setEntityValue(entity, to);
            await transactionManager.save(entity);
        });
        return Promise.resolve();
    }

    async moveEntityQueriesBuilder(alias: string, closureTableAlias: string, entity: Entity, to: Entity|null): Promise<QueryBuilder<Entity|unknown>[]> {
        const escape = (alias: string) => this.manager.connection.driver.escape(alias);
        const entDescendants = await this.findDescendants(entity);
        const toAncestors = to ? await this.findAncestors(to) : [];
        // entity must be an ancestor of itself
        toAncestors.push(entity);

        if (this.metadata.treeType === "closure-table") {
            // delete all ancestors -> entity + entity descendants closures
            const delAncestorsParameters: ObjectLiteral = {};
            const descendantWhereCondition = entDescendants.map(e => {
                const eCondition = this.metadata.closureJunctionTable.descendantColumns.map(column => {
                    const eVal = column.referencedColumn!.getEntityValue(e);
                    const eKey = column.referencedColumn!.propertyName + eVal;
                    delAncestorsParameters[eKey] = eVal;
                    return escape(column.propertyPath) + ` = :${eKey}`;
                }).join(" AND ");
                return `(${eCondition})`;
            }).join(" OR ");
            const clearAncestorsQuery = this.createQueryBuilder()
                .delete()
                .from(this.metadata.closureJunctionTable.tableName)
                .where(descendantWhereCondition)
                .setParameters(delAncestorsParameters);

            // All toAncestors must be made ancestors of entDescendants
            const closuresToInsert = toAncestors.reduce<ObjectLiteral[]>((closures, ancestorEntity) => {
                const ancestorPartial = this.metadata.closureJunctionTable.ancestorColumns.reduce<ObjectLiteral>(
                    (prevPartial, column) => {
                        const aKey = column.propertyPath;
                        const aVal = column.referencedColumn!.getEntityValue(ancestorEntity);
                        return { ...prevPartial, [aKey]: aVal };
                    }, {});
                const descendentPartials = entDescendants.map(descendantEntity => {
                    const descendentPartial = this.metadata.closureJunctionTable.descendantColumns.reduce<ObjectLiteral>((prevPartial, column) => {
                        const dKey = column.propertyPath;
                        const dVal = column.referencedColumn!.getEntityValue(descendantEntity);
                        return { ...prevPartial, [dKey]: dVal };
                    }, {});
                    return descendentPartial;
                });
                const newClosuresToInsert = descendentPartials.map(descendentPartial => ({ ...ancestorPartial, ...descendentPartial }));
                return [...closures, ...newClosuresToInsert];
            }, []);
            // insert all toancestors -> entity + entity descendants closures

            // TODO: Why are all closures to insert undefined in this query?
            const insertAncestorsQuery = this.createQueryBuilder()
                .insert()
                .into(this.metadata.closureJunctionTable.tableName)
                .values(closuresToInsert);
            return [clearAncestorsQuery, insertAncestorsQuery];
        }
        return [];
    }

    // -------------------------------------------------------------------------
    // Protected Methods
    // -------------------------------------------------------------------------

    protected createRelationMaps(alias: string, rawResults: any[]): { id: any, parentId: any }[] {
        return rawResults.map(rawResult => {
            const joinColumn = this.metadata.treeParentRelation!.joinColumns[0];
            // fixes issue #2518, default to databaseName property when givenDatabaseName is not set
            const joinColumnName = joinColumn.givenDatabaseName || joinColumn.databaseName;
            const id = rawResult[alias + "_" + this.metadata.primaryColumns[0].databaseName];
            const parentId = rawResult[alias + "_" + joinColumnName];
            return {
                id: this.manager.connection.driver.prepareHydratedValue(id, this.metadata.primaryColumns[0]),
                parentId: this.manager.connection.driver.prepareHydratedValue(parentId, joinColumn),
            };
        });
    }

    protected buildChildrenEntityTree(entity: any, entities: any[], relationMaps: { id: any, parentId: any }[]): void {
        const childProperty = this.metadata.treeChildrenRelation!.propertyName;
        const parentEntityId = this.metadata.primaryColumns[0].getEntityValue(entity);
        const childRelationMaps = relationMaps.filter(relationMap => relationMap.parentId === parentEntityId);
        const childIds = childRelationMaps.map(relationMap => relationMap.id);
        entity[childProperty] = entities.filter(entity => childIds.indexOf(entity.id) !== -1);
        entity[childProperty].forEach((childEntity: any) => {
            this.buildChildrenEntityTree(childEntity, entities, relationMaps);
        });
    }

    protected buildParentEntityTree(entity: any, entities: any[], relationMaps: { id: any, parentId: any }[]): void {
        const parentProperty = this.metadata.treeParentRelation!.propertyName;
        const entityId = this.metadata.primaryColumns[0].getEntityValue(entity);
        const parentRelationMap = relationMaps.find(relationMap => relationMap.id === entityId);
        const parentEntity = entities.find(entity => {
            if (!parentRelationMap)
                return false;

            return entity[this.metadata.primaryColumns[0].propertyName] === parentRelationMap.parentId;
        });
        if (parentEntity) {
            entity[parentProperty] = parentEntity;
            this.buildParentEntityTree(entity[parentProperty], entities, relationMaps);
        }
    }

}
