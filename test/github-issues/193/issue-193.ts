import { ClassType } from "class-transformer/ClassTransformer";
import "reflect-metadata";
import { Connection } from "../../../src";
import { closeTestingConnections, createTestingConnections, reloadTestingDatabases } from "../../utils/test-utils";
import { ClosureCategory } from "./entity/ClosureCategory";

describe("github issues > #193 Remove and Move entities from TreeRepository", () => {
    let connections: Connection[];
    before(async () => connections = await createTestingConnections({
        entities: [__dirname + "/entity/*{.js,.ts}"],
    }));
    beforeEach(() => reloadTestingDatabases(connections));
    after(() => closeTestingConnections(connections));

    const moveGenericTest = async (conn: Connection, type: ClassType<ClosureCategory>) => {
        const categoryRepository = conn.getTreeRepository(type);

        /**
         * Starting State:
         *   A
         *  / \
         * B   C
         *      \
         *       D
         */
        const a = new type();
        a.name = "A";
        const b = new type();
        b.name = "B";
        const c = new type();
        c.name = "C";
        const d = new type();
        d.name = "D";
        b.parentCategory = a;
        c.parentCategory = a;
        d.parentCategory = c;
        await categoryRepository.save(a);
        await categoryRepository.save(b);
        await categoryRepository.save(c);
        await categoryRepository.save(d);

        const baseRoots = await categoryRepository.findRoots();
        baseRoots.length.should.be.equal(1);

        const cTree = await categoryRepository.findDescendantsTree(c);
        cTree.should.be.equal(c);
        cTree.childCategories.length.should.be.equal(1);
        cTree.childCategories[0].id.should.be.equal(d.id);
        cTree.childCategories[0].name.should.be.equal(d.name);

        /**
         * Move B (from A) to C
         * A
         *  \
         *   C
         *  / \
         * B   D
         */

        // await categoryRepository.move(b, c);
        // const cTreeWithB = await categoryRepository.findDescendantsTree(c);
        // cTreeWithB.should.be.equal(c);
        // cTreeWithB.childCategories.length.should.be.equal(2);
        const [clearClosureQuery, insertClosuresQuery] = await categoryRepository.moveEntityQueriesBuilder("unused", "unused", b, c);
        const [clearClosureSQL, clearClosureParameters] = clearClosureQuery.getQueryAndParameters();
        clearClosureSQL.should.be.equal(`DELETE FROM "gh_193_closure" WHERE ("id_descendant" = $1)`);
        clearClosureParameters.should.be.eql([2]);
        const [insertClosuresSQL, insertClosuresParameters] = insertClosuresQuery.getQueryAndParameters();
        insertClosuresSQL.should.be.equal(
            `INSERT INTO "gh_193_closure"("id_ancestor", "id_descendant") VALUES (DEFAULT, DEFAULT), (DEFAULT, DEFAULT), (DEFAULT, DEFAULT)`
        );
        insertClosuresParameters.should.be.eql(
            [{ id_ancestor: 1, id_descendant: 2 }, { id_ancestor: 3, id_descendant: 2 }, { id_ancestor: 2, id_descendant: 2 }]
        );
    };

    describe("closure-tables", () => {
        it("should move appropriately", () => Promise.all(connections.map(async connection => {
            await moveGenericTest(connection, ClosureCategory);
        })));
    });
});
