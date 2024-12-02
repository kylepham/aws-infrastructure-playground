import * as cdk from "aws-cdk-lib";
import {
  Instance,
  InstanceType,
  InterfaceVpcEndpoint,
  InterfaceVpcEndpointService,
  IpAddresses,
  MachineImage,
  Peer,
  Port,
  SecurityGroup,
  SubnetType,
  Vpc,
  VpcEndpoint,
  VpcEndpointService,
} from "aws-cdk-lib/aws-ec2";
import {
  NetworkLoadBalancer,
  Protocol,
} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { InstanceIdTarget } from "aws-cdk-lib/aws-elasticloadbalancingv2-targets";
import { Construct } from "constructs";

export class PrivateLinkStack extends cdk.Stack {
  private producerVpc: Vpc;
  private nlb: NetworkLoadBalancer;
  private producerEc2: Instance;
  private vpcEndpointService: VpcEndpointService;

  private consumerVpc: Vpc;
  private vpcEndpoint: VpcEndpoint;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this._createProducer();
    this._createConsumer();
  }

  private _createConsumer() {
    this.consumerVpc = this._createConsumerVpc();
    this.vpcEndpoint = this._createVpcEndpoint();
  }

  private _createConsumerVpc() {
    return new Vpc(this, "ConsumerVpc", {
      ipAddresses: IpAddresses.cidr("10.22.0.0/16"),
      createInternetGateway: false,
    });
  }

  private _createVpcEndpoint() {
    return new InterfaceVpcEndpoint(this, "VpcEndpoint", {
      vpc: this.consumerVpc,
      service: new InterfaceVpcEndpointService(
        this.vpcEndpointService.vpcEndpointServiceName,
        80
      ),
      subnets: this.consumerVpc.selectSubnets({
        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
      }),
    });
  }

  // ---------------------------------

  private _createProducer() {
    this.producerVpc = this._createProducerVpc();
    this.producerEc2 = this._createProducerEC2();
    this.nlb = this._createNLB();
    this.vpcEndpointService = this._createEndpointService();
  }

  private _createProducerVpc() {
    return new Vpc(this, "ProducerVpc", {
      ipAddresses: IpAddresses.cidr("10.21.0.0/16"),
      createInternetGateway: false,
    });
  }

  private _createNLB() {
    const nlb = new NetworkLoadBalancer(this, "NetworkLoadBalancer", {
      vpc: this.producerVpc,
      vpcSubnets: this.producerVpc.selectSubnets({
        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
      }),
    });
    const listener = nlb.addListener("NLB-Listener", {
      protocol: Protocol.TCP,
      port: 80,
    });

    // TODO: investigate and fix health check
    // this creates a target group with targets
    listener.addTargets("NLB-Target", {
      protocol: Protocol.TCP, // this should be inherited from listener
      port: 80,
      targetGroupName: "TargetGroup",
      // https://stackoverflow.com/questions/64106253/create-network-load-balancer-nlb-using-existing-ec2-instances-with-aws-cdk
      targets: [new InstanceIdTarget(this.producerEc2.instanceId, 80)],
    });

    return nlb;
  }

  private _createEndpointService() {
    return new VpcEndpointService(this, "VpcEndpointService", {
      vpcEndpointServiceLoadBalancers: [this.nlb],
      acceptanceRequired: true,
    });
  }

  private _createProducerEC2() {
    const producerEC2SecurityGroup = new SecurityGroup(
      this,
      "ProducerEC2SecurityGroup",
      {
        vpc: this.producerVpc,
      }
    );
    producerEC2SecurityGroup.addIngressRule(
      Peer.anyIpv4(),
      Port.allTcp(),
      "Allow all inbound"
    );

    return new Instance(this, "ProducerEC2", {
      instanceType: new InstanceType("t2.micro"),
      machineImage: MachineImage.latestAmazonLinux2(),
      vpc: this.producerVpc,
      vpcSubnets: this.producerVpc.selectSubnets({
        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
      }),
      securityGroup: producerEC2SecurityGroup,
    });
  }
}
