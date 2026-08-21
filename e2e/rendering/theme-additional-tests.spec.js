import { test } from '@playwright/test';
import { imgSnapshotTest } from '../helpers/util.ts';

// TODO: Delete/Rename this describe, keeping the inner contents.
test.describe('Extended theme test', () => {
  [
    'mc',
    'neo',
    'neo-dark',
    'default',
    'forest',
    'base',
    'dark',
    'neutral',
    'redux',
    'redux-dark',
    'redux-color',
    'redux-dark-color',
  ].forEach((theme) => {
    test.describe(theme, () => {
      test('should render an Architecture diagram', async ({ page }, testInfo) => {
        await imgSnapshotTest(
          page,
          testInfo,
          `
       architecture-beta
        group api(cloud)[API]

        service db(database)[Database] in api
        service disk1(disk)[Storage] in api
        service disk2(disk)[Storage] in api
        service server(server)[Server] in api

        db:L -- R:server
        disk1:T -- B:server
        disk2:T -- B:db
          `,
          { theme }
        );
      });
      test('should render a block diagram', async ({ page }, testInfo) => {
        await imgSnapshotTest(
          page,
          testInfo,
          `
      block-beta
      columns 1
        db(("DB"))
        blockArrowId6<["&nbsp;&nbsp;&nbsp;"]>(down)
        block:ID
          A
          B["A wide one in the middle"]
          C
        end
        space
        D
        ID --> D
        C --> D
        style B fill:#d6d,stroke:#333,stroke-width:4px
          `,
          { theme }
        );
      });
      test('should render a C4 diagram', async ({ page }, testInfo) => {
        await imgSnapshotTest(
          page,
          testInfo,
          `
          C4Context
          title System Context diagram for Internet Banking System
          Enterprise_Boundary(b0, "BankBoundary0") {
            Person(customerA, "Banking Customer A", "A customer of the bank, with personal bank accounts.")
            Person(customerB, "Banking Customer B")
            Person_Ext(customerC, "Banking Customer C", "desc")

            Person(customerD, "Banking Customer D", "A customer of the bank, <br/> with personal bank accounts.")

            System(SystemAA, "Internet Banking System", "Allows customers to view information about their bank accounts, and make payments.")

            Enterprise_Boundary(b1, "BankBoundary") {

              SystemDb_Ext(SystemE, "Mainframe Banking System", "Stores all of the core banking information about customers, accounts, transactions, etc.")

              System_Boundary(b2, "BankBoundary2") {
                System(SystemA, "Banking System A")
                System(SystemB, "Banking System B", "A system of the bank, with personal bank accounts. next line.")
              }

              System_Ext(SystemC, "E-mail system", "The internal Microsoft Exchange e-mail system.")
              SystemDb(SystemD, "Banking System D Database", "A system of the bank, with personal bank accounts.")

              Boundary(b3, "BankBoundary3", "boundary") {
                SystemQueue(SystemF, "Banking System F Queue", "A system of the bank.")
                SystemQueue_Ext(SystemG, "Banking System G Queue", "A system of the bank, with personal bank accounts.")
              }
            }
          }

          BiRel(customerA, SystemAA, "Uses")
          BiRel(SystemAA, SystemE, "Uses")
          Rel(SystemAA, SystemC, "Sends e-mails", "SMTP")
          Rel(SystemC, customerA, "Sends e-mails to")

          UpdateElementStyle(customerA, $fontColor="red", $bgColor="grey", $borderColor="red")
          UpdateRelStyle(customerA, SystemAA, $textColor="blue", $lineColor="blue", $offsetX="5")
          UpdateRelStyle(SystemAA, SystemE, $textColor="blue", $lineColor="blue", $offsetY="-10")
          UpdateRelStyle(SystemAA, SystemC, $textColor="blue", $lineColor="blue", $offsetY="-40", $offsetX="-50")
          UpdateRelStyle(SystemC, customerA, $textColor="red", $lineColor="red", $offsetX="-50", $offsetY="20")

          UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
          `,
          { theme }
        );
      });
      test('should render a Pie chart', async ({ page }, testInfo) => {
        await imgSnapshotTest(
          page,
          testInfo,
          `
            pie title Pets adopted by volunteers
              "Dogs" : 386
              "Cats" : 85
              "Rats" : 15
          `,
          { theme }
        );
      });

      test('should render a Quadrant chart', async ({ page }, testInfo) => {
        await imgSnapshotTest(
          page,
          testInfo,
          `
        quadrantChart
          title Reach and engagement of campaigns
          x-axis Low Reach --> High Reach
          y-axis Low Engagement --> High Engagement
          quadrant-1 We should expand
          quadrant-2 Need to promote
          quadrant-3 Re-evaluate
          quadrant-4 May be improved
          Campaign A: [0.3, 0.6]
          Campaign B: [0.45, 0.23]
          Campaign C: [0.57, 0.69]
          Campaign D: [0.78, 0.34]
          Campaign E: [0.40, 0.34]
          Campaign F: [0.35, 0.78]
          `,
          { theme }
        );
      });
      test('should render a User Jorney', async ({ page }, testInfo) => {
        await imgSnapshotTest(
          page,
          testInfo,
          `
       journey
        title My working day
        section Go to work
          Make tea: 5: Me
          Go upstairs: 3: Me
          Do work: 1: Me, Cat
        section Go home
          Go downstairs: 5: Me
          Sit down: 5: Me
          `,
          { theme }
        );
      });
      test('should render a XY chart', async ({ page }, testInfo) => {
        await imgSnapshotTest(
          page,
          testInfo,
          `
          xychart-beta
              title "Training progress"
              x-axis [mon, tues, wed, thur, fri, sat, sun]
              y-axis "Time trained (minutes)" 0 --> 300
              bar [60, 0, 120, 180, 230, 300, 0]
              line [60, 0, 120, 180, 230, 300, 0]
          `,
          { theme }
        );
      });
      test('should render a Packet diagram', async ({ page }, testInfo) => {
        await imgSnapshotTest(
          page,
          testInfo,
          `
          packet-beta
              title UDP Packet
              0-15: "Source Port"
              16-31: "Destination Port"
              32-47: "Length"
              48-63: "Checksum"
              64-95: "Data (variable length)"
          `,
          { theme }
        );
      });
    });
  });
});
