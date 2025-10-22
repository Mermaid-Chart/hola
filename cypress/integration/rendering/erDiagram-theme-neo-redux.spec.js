import { imgSnapshotTest } from '../../helpers/util.ts';

describe('Git Graph', () => {
  ['neo', 'neo-dark', 'redux', 'redux-dark', 'redux-color', 'redux-dark-color'].forEach((theme) => {
    describe(theme, () => {
      it('should render a erDiagram', () => {
        imgSnapshotTest(
          `
       erDiagram
        CAR ||--o{ DRIVER : allows
        CAR {
            string registrationNumber PK
            string make
            string model
            string[] parts
        }
        PERSON ||--o{ DRIVER : is
        PERSON {
            string driversLicense PK "The license #"
            string(99) firstName "Only 99 characters are allowed"
            string lastName
            string phone UK
            int age
        }
        DRIVER {
            string carRegistrationNumber PK, FK
            string driverLicense PK, FK
        }
          `,
          { theme, look: 'neo' }
        );
      });
    });
  });
});
