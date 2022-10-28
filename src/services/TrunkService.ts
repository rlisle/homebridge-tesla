import { Service } from "homebridge";
import { wait } from "../util/wait";
import {
  TeslaPluginService,
  TeslaPluginServiceContext,
} from "./TeslaPluginService";

const teslajs = require("teslajs");

export type Trunk = {
  name: string; // Like "Front Trunk"
  subtype: string; // Like "frontTrunk"
  apiName: any;
};

export const FrontTrunk: Trunk = {
  name: "Front Trunk",
  subtype: "frontTrunk",
  apiName: teslajs.FRUNK,
};

export const RearTrunk: Trunk = {
  name: "Trunk",
  subtype: "trunk",
  apiName: teslajs.TRUNK,
};

export class TrunkService extends TeslaPluginService {
  trunk: Trunk;

  constructor(trunk: Trunk, context: TeslaPluginServiceContext) {
    super(context);
    this.trunk = trunk;
  }

  createService(): Service {
    const { trunk } = this;
    const { hap } = this.context;

    const service = new hap.Service.LockMechanism(
      this.serviceName(trunk.name),
      trunk.subtype,
    );

    service
      .getCharacteristic(hap.Characteristic.LockCurrentState)
      .on("get", this.createGetter(this.getCurrentState));

    service
      .getCharacteristic(hap.Characteristic.LockTargetState)
      .on("get", this.createGetter(this.getTargetState))
      .on("set", this.createSetter(this.setTargetState));

    return service;
  }

  async getCurrentState() {
    const { log, tesla, hap } = this.context;
    const { name } = this.trunk;

    const data = await tesla.getVehicleData();

    // Assume closed when not connected.
    const opened = data ? !!data.vehicle_state.rt : false;

    log(`Get ${name} current state; opened?`, opened);

    return opened
      ? hap.Characteristic.LockCurrentState.UNSECURED
      : hap.Characteristic.LockCurrentState.SECURED;
  }

  async getTargetState() {
    const { log, tesla, hap } = this.context;
    const { name } = this.trunk;

    const data = await tesla.getVehicleData();

    // Assume closed when not connected.
    const opening = data ? !!data.vehicle_state.rt : false;

    log(`Get ${name} target state; opening?`, opening);

    return opening
      ? hap.Characteristic.LockTargetState.UNSECURED
      : hap.Characteristic.LockTargetState.SECURED;
  }

  async setTargetState(state: number) {
    const { service } = this;
    const { log, tesla, hap } = this.context;
    const { name, apiName } = this.trunk;

    const opening = state === hap.Characteristic.LockTargetState.UNSECURED;

    log(`Set ${name} target state; opening?`, opening);

    const options = await tesla.getOptions();

    const background = async () => {
      // Wake up, this is important!
      await tesla.wakeUp(options);

      // Try and prevent closing the trunk when you wanted to open it, and vice
      // versa.
      const data = await tesla.getVehicleData();

      if (data) {
        const opened = !!data.vehicle_state.rt;
        if (opened === opening) {
          log(`${name} already in desired state, skipping.`);
          return;
        }
      }

      log(`Actuating ${name}`);

      // Now technically we are just "actuating" the state here; if you asked
      // to open the trunk, we will just "actuate" it. On the Model 3, that means
      // pop it no matter what you say - if you say "Close" it'll do nothing.
      // On the models with power liftgates, if you say "Open" or "Close"
      // it will do the same thing: "actuate" which means to just toggle it.
      await tesla.command("openTrunk", options, apiName);
    };

    // Don't wait for this to finish, just return immediately.
    background();

    // We need to update the current state "later" because Siri can't
    // handle receiving the change event inside the same "set target state"
    // response.
    await wait(1);

    if (state == hap.Characteristic.LockTargetState.SECURED) {
      service.setCharacteristic(
        hap.Characteristic.LockCurrentState,
        hap.Characteristic.LockCurrentState.SECURED,
      );
    } else {
      service.setCharacteristic(
        hap.Characteristic.LockCurrentState,
        hap.Characteristic.LockCurrentState.UNSECURED,
      );
    }
  }
}
