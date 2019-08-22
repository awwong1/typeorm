import { PrimaryGeneratedColumn } from "../../../../src/decorator/columns/PrimaryGeneratedColumn";
import { Column } from "../../../../src/decorator/columns/Column";
import { TreeParent } from "../../../../src/decorator/tree/TreeParent";
import { TreeChildren } from "../../../../src/decorator/tree/TreeChildren";
import { Entity } from "../../../../src/decorator/entity/Entity";
import { Tree } from "../../../../src/decorator/tree/Tree";

@Entity("gh_193")
@Tree("closure-table")
export class ClosureCategory {

    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    name: string;

    @TreeParent()
    parentCategory: ClosureCategory;

    @TreeChildren({ cascade: true })
    childCategories: ClosureCategory[];

}